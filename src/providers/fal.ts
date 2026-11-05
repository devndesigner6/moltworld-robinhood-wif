import type { ModelDefinition } from "../models/registry.js";
import {
  AIProvider,
  ImageGenerationRequest,
  ImageGenerationResponse,
  UpstreamError,
  UpstreamResult,
  VideoGenerationRequest,
  VideoJobStatus,
  VideoJobSubmission,
  upstreamFetch,
} from "./types.js";

const SIZE_TO_ASPECT: Record<string, string> = {
  "1024x1024": "1:1",
  "1024x1792": "9:16",
  "1792x1024": "16:9",
};

interface FalQueueHandle {
  request_id: string;
  status_url: string;
  response_url: string;
}

export function buildFalImageInput(model: ModelDefinition, request: ImageGenerationRequest): Record<string, unknown> {
  const size = request.size ?? "1024x1024";
  const input: Record<string, unknown> = { prompt: request.prompt };
  if (model.image?.sizeParam === "aspect_ratio") {
    input.aspect_ratio = SIZE_TO_ASPECT[size] ?? "1:1";
  } else {
    const [width, height] = size.split("x").map(Number);
    input.image_size = { width, height };
  }
  if ((model.limits.maxImages ?? 1) > 1) input.num_images = request.n ?? 1;
  return input;
}

export function buildFalVideoInput(model: ModelDefinition, request: VideoGenerationRequest): Record<string, unknown> {
  const spec = model.video!;
  const seconds = request.duration ?? spec.durations[0];
  const duration =
    spec.durationFormat === "suffix_s" ? `${seconds}s` : spec.durationFormat === "string" ? String(seconds) : seconds;
  return {
    prompt: request.prompt,
    duration,
    aspect_ratio: request.aspect_ratio ?? spec.aspectRatios[0],
    ...(spec.extraInput ?? {}),
  };
}

export class FalProvider implements AIProvider {
  readonly id = "fal";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = 60000
  ) {
    if (!apiKey) throw new Error("FAL_KEY is required to initialize FalProvider.");
  }

  private headers() {
    return { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async generateImage(model: ModelDefinition, request: ImageGenerationRequest): Promise<UpstreamResult<ImageGenerationResponse>> {
    const res = await upstreamFetch(`https://fal.run/${model.upstreamModelId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(buildFalImageInput(model, request)),
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "fal.ai image",
    });
    const data: any = await res.json();
    const images: any[] = Array.isArray(data.images) ? data.images : [];
    const urls = images.map((img) => img?.url).filter((u): u is string => typeof u === "string" && u.length > 0);
    if (!urls.length) throw new UpstreamError("fal.ai returned no images.");
    return {
      body: {
        created: Math.floor(Date.now() / 1000),
        data: urls.map((url) => ({ url, revised_prompt: data.revised_prompt ?? undefined })),
      },
      upstreamProvider: "fal",
      upstreamModel: model.upstreamModelId,
    };
  }

  async submitVideo(model: ModelDefinition, request: VideoGenerationRequest): Promise<VideoJobSubmission> {
    const res = await upstreamFetch(`https://queue.fal.run/${model.upstreamModelId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(buildFalVideoInput(model, request)),
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "fal.ai video queue",
    });
    const data: any = await res.json();
    if (!data.request_id || !data.status_url || !data.response_url) {
      throw new UpstreamError("fal.ai queue response is missing request_id/status_url/response_url.");
    }
    const handle: FalQueueHandle = {
      request_id: data.request_id,
      status_url: data.status_url,
      response_url: data.response_url,
    };
    return { upstreamJobId: JSON.stringify(handle) };
  }

  async getVideoStatus(_model: ModelDefinition, upstreamJobId: string): Promise<VideoJobStatus> {
    const handle = JSON.parse(upstreamJobId) as FalQueueHandle;
    const statusRes = await upstreamFetch(handle.status_url, {
      headers: this.headers(),
      timeoutMs: 15000,
      secret: this.apiKey,
      label: "fal.ai job status",
    });
    const status: any = await statusRes.json();
    if (status.status === "IN_QUEUE") return { state: "queued" };
    if (status.status !== "COMPLETED") return { state: "processing" };

    // A completed queue item can still hold a failed result; the response URL tells us which.
    const resultRes = await fetch(handle.response_url, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    const result: any = await resultRes.json().catch(() => ({}));
    if (!resultRes.ok) {
      const detail = result?.detail ?? result?.error ?? `HTTP ${resultRes.status}`;
      return { state: "failed", error: `fal.ai generation failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` };
    }
    const videoUrl = result?.video?.url;
    if (typeof videoUrl !== "string") return { state: "failed", error: "fal.ai result contained no video URL." };
    return { state: "completed", videoUrl };
  }
}
