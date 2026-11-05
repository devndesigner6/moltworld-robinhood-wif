import type { ModelDefinition } from "../models/registry.js";
import {
  AIProvider,
  AudioSpeechRequest,
  AudioSpeechResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  UpstreamError,
  UpstreamResult,
  VideoGenerationRequest,
  VideoJobStatus,
  VideoJobSubmission,
  upstreamFetch,
} from "./types.js";

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

const SORA_SIZES: Record<string, string> = { "16:9": "1280x720", "9:16": "720x1280" };

export class DirectOpenAIProvider implements AIProvider {
  readonly id = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = 25000
  ) {}

  private auth() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async generateImage(model: ModelDefinition, request: ImageGenerationRequest): Promise<UpstreamResult<ImageGenerationResponse>> {
    const res = await upstreamFetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.upstreamModelId,
        prompt: request.prompt,
        n: request.n ?? 1,
        size: request.size ?? "1024x1024",
        quality: "medium",
      }),
      timeoutMs: Math.max(this.timeoutMs, 90000),
      secret: this.apiKey,
      label: "OpenAI images",
    });
    const data: any = await res.json();
    const items = (data.data ?? []).filter((d: any) => d?.b64_json || d?.url);
    if (!items.length) throw new UpstreamError("OpenAI images returned no images.");
    return {
      body: {
        created: Number(data.created ?? Math.floor(Date.now() / 1000)),
        data: items.map((d: any) => ({ url: d.url, b64_json: d.b64_json, revised_prompt: d.revised_prompt })),
      },
      upstreamProvider: "openai",
      upstreamModel: model.upstreamModelId,
    };
  }

  async generateSpeech(model: ModelDefinition, request: AudioSpeechRequest): Promise<UpstreamResult<AudioSpeechResponse>> {
    const format = request.response_format ?? "mp3";
    const res = await upstreamFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.upstreamModelId,
        input: request.input,
        voice: request.voice ?? "alloy",
        response_format: format,
        speed: request.speed ?? 1,
      }),
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "OpenAI speech",
    });
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new UpstreamError("OpenAI speech returned empty audio.");
    return {
      body: {
        object: "audio.speech",
        created: Math.floor(Date.now() / 1000),
        model: model.slug,
        format,
        mime_type: MIME[format] ?? "application/octet-stream",
        audio_b64: audio.toString("base64"),
        character_count: request.input.length,
      },
      upstreamProvider: "openai",
      upstreamModel: model.upstreamModelId,
    };
  }

  async submitVideo(model: ModelDefinition, request: VideoGenerationRequest): Promise<VideoJobSubmission> {
    const form = new FormData();
    form.set("model", model.upstreamModelId);
    form.set("prompt", request.prompt);
    form.set("seconds", String(request.duration ?? 4));
    form.set("size", SORA_SIZES[request.aspect_ratio ?? "16:9"] ?? "1280x720");
    const res = await upstreamFetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: this.auth(),
      body: form,
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "OpenAI videos",
    });
    const data: any = await res.json();
    if (!data.id) throw new UpstreamError("OpenAI videos response is missing an id.");
    return { upstreamJobId: String(data.id) };
  }

  async getVideoStatus(_model: ModelDefinition, upstreamJobId: string): Promise<VideoJobStatus> {
    const res = await upstreamFetch(`https://api.openai.com/v1/videos/${encodeURIComponent(upstreamJobId)}`, {
      headers: this.auth(),
      timeoutMs: 15000,
      secret: this.apiKey,
      label: "OpenAI video status",
    });
    const data: any = await res.json();
    switch (data.status) {
      case "queued":
        return { state: "queued" };
      case "in_progress":
        return { state: "processing" };
      case "completed":
        return { state: "completed", requiresProxy: true };
      default:
        return { state: "failed", error: `OpenAI video ${data.status ?? "failed"}: ${data.error?.message ?? "no detail"}` };
    }
  }

  async fetchVideoContent(_model: ModelDefinition, upstreamJobId: string): Promise<Response> {
    return upstreamFetch(`https://api.openai.com/v1/videos/${encodeURIComponent(upstreamJobId)}/content`, {
      headers: this.auth(),
      timeoutMs: 120000,
      secret: this.apiKey,
      label: "OpenAI video content",
    });
  }
}
