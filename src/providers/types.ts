import type { ModelDefinition } from "../models/registry.js";

export type ModelModality = "chat" | "image" | "voice" | "video";

// ----------------------------------------------------
// Chat (OpenAI-compatible)
// ----------------------------------------------------
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

// ----------------------------------------------------
// Image
// ----------------------------------------------------
export interface ImageGenerationRequest {
  prompt: string;
  n?: number;
  size?: string;
}

export interface GeneratedImageItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  created: number;
  data: GeneratedImageItem[];
}

// ----------------------------------------------------
// Voice
// ----------------------------------------------------
export interface AudioSpeechRequest {
  input: string;
  voice?: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav";
  speed?: number;
}

export interface AudioSpeechResponse {
  object: "audio.speech";
  created: number;
  model: string;
  format: string;
  mime_type: string;
  audio_b64: string;
  character_count: number;
}

// ----------------------------------------------------
// Video (async jobs)
// ----------------------------------------------------
export interface VideoGenerationRequest {
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
}

export interface VideoJobSubmission {
  upstreamJobId: string;
}

export type VideoJobStatus =
  | { state: "queued" | "processing" }
  | { state: "completed"; videoUrl?: string; requiresProxy?: boolean }
  | { state: "failed"; error: string };

// ----------------------------------------------------
// Provider contract
// ----------------------------------------------------

/** What actually happened upstream, recorded on the ledger and in the receipt. */
export interface UpstreamResult<T> {
  body: T;
  upstreamProvider: string;
  upstreamModel: string;
  upstreamCostUsd?: number;
  usage?: ChatCompletionUsage;
}

export interface AIProvider {
  readonly id: string;
  chatComplete?(model: ModelDefinition, request: ChatCompletionRequest): Promise<UpstreamResult<ChatCompletionResponse>>;
  generateImage?(model: ModelDefinition, request: ImageGenerationRequest): Promise<UpstreamResult<ImageGenerationResponse>>;
  generateSpeech?(model: ModelDefinition, request: AudioSpeechRequest): Promise<UpstreamResult<AudioSpeechResponse>>;
  submitVideo?(model: ModelDefinition, request: VideoGenerationRequest): Promise<VideoJobSubmission>;
  getVideoStatus?(model: ModelDefinition, upstreamJobId: string): Promise<VideoJobStatus>;
  /** For upstreams whose video bytes need our credentials (OpenAI). */
  fetchVideoContent?(model: ModelDefinition, upstreamJobId: string): Promise<Response>;
}

/** Thrown for any upstream failure. Never fabricate output in its place. */
export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "UpstreamError";
  }
}

export function redact(text: string, secret?: string): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

export async function upstreamFetch(
  url: string,
  init: RequestInit & { timeoutMs: number; secret?: string; label: string }
): Promise<Response> {
  const { timeoutMs, secret, label, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new UpstreamError(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw new UpstreamError(`${label} request failed: ${redact(String(err?.message ?? err), secret)}`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text);
      const d = parsed?.error?.message ?? parsed?.detail ?? parsed?.message ?? text;
      detail = (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 500);
    } catch {
      // keep status-only detail
    }
    throw new UpstreamError(`${label} error: ${redact(detail, secret)}`, res.status);
  }
  return res;
}
