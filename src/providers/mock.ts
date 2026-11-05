import type { ModelDefinition } from "../models/registry.js";
import {
  AIProvider,
  AudioSpeechRequest,
  AudioSpeechResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  UpstreamError,
  UpstreamResult,
  VideoGenerationRequest,
  VideoJobStatus,
  VideoJobSubmission,
} from "./types.js";

/**
 * Deterministic stand-in for every upstream, for local development and tests.
 * Output is labelled as mock output. assertProductionConfig() refuses to start a
 * mainnet gateway with mock providers enabled.
 */
export const mockControls = {
  /** Make the next N upstream calls throw. */
  failNext: 0,
  /** Outcome the next video job reaches when polled. */
  videoOutcome: "completed" as "completed" | "failed",
  /** Artificial upstream latency, to exercise concurrency guards. */
  delayMs: 0,
  calls: 0,
  reset() {
    this.failNext = 0;
    this.delayMs = 0;
    this.videoOutcome = "completed";
    this.calls = 0;
  },
};

const videoJobs = new Map<string, { outcome: "completed" | "failed"; polls: number }>();

async function maybeFail(label: string) {
  mockControls.calls++;
  if (mockControls.delayMs) await new Promise((r) => setTimeout(r, mockControls.delayMs));
  if (mockControls.failNext > 0) {
    mockControls.failNext--;
    throw new UpstreamError(`Mock ${label} failure (injected).`);
  }
}

export class MockProvider implements AIProvider {
  readonly id = "mock";

  async chatComplete(model: ModelDefinition, request: ChatCompletionRequest): Promise<UpstreamResult<ChatCompletionResponse>> {
    await maybeFail("chat");
    const last = request.messages[request.messages.length - 1]?.content ?? "";
    const content = `[mock ${model.slug}] ${last.slice(0, 200)}`;
    const usage = {
      prompt_tokens: Math.ceil(last.length / 4) + 8,
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: 0,
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    return {
      body: {
        id: `chatcmpl-mock-${mockControls.calls}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model.slug,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage,
      },
      upstreamProvider: "mock",
      upstreamModel: model.upstreamModelId,
      usage,
    };
  }

  async generateImage(model: ModelDefinition, request: ImageGenerationRequest): Promise<UpstreamResult<ImageGenerationResponse>> {
    await maybeFail("image");
    const n = request.n ?? 1;
    return {
      body: {
        created: Math.floor(Date.now() / 1000),
        data: Array.from({ length: n }, (_, i) => ({ url: `https://mock.moltworld.invalid/${model.slug}/${i}.png` })),
      },
      upstreamProvider: "mock",
      upstreamModel: model.upstreamModelId,
    };
  }

  async generateSpeech(model: ModelDefinition, request: AudioSpeechRequest): Promise<UpstreamResult<AudioSpeechResponse>> {
    await maybeFail("speech");
    return {
      body: {
        object: "audio.speech",
        created: Math.floor(Date.now() / 1000),
        model: model.slug,
        format: request.response_format ?? "mp3",
        mime_type: "audio/mpeg",
        audio_b64: Buffer.from(`mock audio for ${request.input.length} chars`).toString("base64"),
        character_count: request.input.length,
      },
      upstreamProvider: "mock",
      upstreamModel: model.upstreamModelId,
    };
  }

  async submitVideo(model: ModelDefinition, _request: VideoGenerationRequest): Promise<VideoJobSubmission> {
    await maybeFail("video");
    const id = `mockvid-${model.slug}-${mockControls.calls}-${Date.now()}`;
    videoJobs.set(id, { outcome: mockControls.videoOutcome, polls: 0 });
    return { upstreamJobId: id };
  }

  async getVideoStatus(model: ModelDefinition, upstreamJobId: string): Promise<VideoJobStatus> {
    const job = videoJobs.get(upstreamJobId);
    if (!job) return { state: "failed", error: "Unknown mock job." };
    job.polls++;
    if (job.polls < 2) return { state: "processing" };
    return job.outcome === "completed"
      ? { state: "completed", videoUrl: `https://mock.moltworld.invalid/${model.slug}/${upstreamJobId}.mp4` }
      : { state: "failed", error: "Mock video generation failed (injected)." };
  }
}
