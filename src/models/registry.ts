import { ModelModality } from "../providers/types.js";

export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxMessages?: number;
  maxPromptChars?: number;
  maxImages?: number;
}

/**
 * What one request costs Moltworld upstream, in USD. Customer prices are always
 * derived from this basis (see src/pricing), never hard-coded.
 */
export type CostBasis =
  | { kind: "tokens"; inputPerMillionUsd: number; outputPerMillionUsd: number }
  | { kind: "per_image"; usd: number }
  | { kind: "per_1k_chars"; usd: number }
  | { kind: "per_second"; usd: number };

export type CostSource = "static" | "openrouter-live" | "fal-live" | "env-override";

export interface ImageSpec {
  /** How the upstream expects dimensions. */
  sizeParam: "image_size" | "aspect_ratio" | "openai";
  sizes: string[];
}

export interface VideoSpec {
  durations: number[];
  /** fal/OpenAI endpoints disagree on the duration wire format. */
  durationFormat: "int" | "string" | "suffix_s";
  aspectRatios: string[];
  extraInput?: Record<string, unknown>;
}

export interface ModelDefinition {
  slug: string;
  displayName: string;
  modality: ModelModality;
  provider: "openrouter" | "openai" | "fal" | "elevenlabs";
  upstreamModelId: string;
  cost: CostBasis;
  costSource: CostSource;
  limits: ModelLimits;
  /** Static switch; runtime availability also requires a configured, verified upstream. */
  enabled: boolean;
  description: string;
  tags: string[];
  image?: ImageSpec;
  video?: VideoSpec;
  voices?: string[];
  audioFormats?: string[];
}

export function getModelEndpoint(model: Pick<ModelDefinition, "slug" | "modality">): string {
  switch (model.modality) {
    case "chat":
      return `/v1/models/${model.slug}/chat/completions`;
    case "image":
      return `/v1/models/${model.slug}/images/generations`;
    case "voice":
      return `/v1/models/${model.slug}/audio/speech`;
    case "video":
      return `/v1/models/${model.slug}/videos/generations`;
  }
}

export function getModelDiscoveryDescription(model: ModelDefinition): string {
  switch (model.modality) {
    case "chat":
      return `Send chat messages to ${model.displayName} and receive a JSON assistant reply. Priced per request from input size and max_tokens.`;
    case "image":
      return `Send a text prompt to ${model.displayName} and receive generated image URLs in JSON. Priced per image.`;
    case "voice":
      return `Send text to ${model.displayName} and receive base64 speech audio in JSON. Priced per character.`;
    case "video":
      return `Send a text prompt to ${model.displayName}; receive a job id to poll for the video URL. Priced per second of video.`;
  }
}

const CHAT_LIMITS: ModelLimits = { maxInputTokens: 4096, maxOutputTokens: 2048, maxMessages: 50, maxPromptChars: 32000 };
const PRO_LIMITS: ModelLimits = { maxInputTokens: 4096, maxOutputTokens: 4096, maxMessages: 50, maxPromptChars: 32000 };

function chat(
  slug: string,
  displayName: string,
  upstreamModelId: string,
  inputPerMillionUsd: number,
  outputPerMillionUsd: number,
  vendor: string,
  limits: ModelLimits = CHAT_LIMITS
): ModelDefinition {
  return {
    slug,
    displayName,
    modality: "chat",
    provider: "openrouter",
    upstreamModelId,
    // Fallback rates only: replaced at startup by OpenRouter's live price list.
    cost: { kind: "tokens", inputPerMillionUsd, outputPerMillionUsd },
    costSource: "static",
    limits,
    enabled: true,
    description: `${displayName} (${upstreamModelId}) served through OpenRouter. OpenAI-compatible chat completions.`,
    tags: ["chat", vendor],
  };
}

export const INITIAL_MODELS: ModelDefinition[] = [
  // Chat: every upstream id below was present in OpenRouter's public model list.
  chat("gpt", "GPT-4o Mini", "openai/gpt-4o-mini", 0.15, 0.6, "openai"),
  chat("gpt-4o", "GPT-4o", "openai/gpt-4o", 2.5, 10, "openai"),
  chat("claude-sonnet", "Claude Sonnet 4.5", "anthropic/claude-sonnet-4.5", 3, 15, "anthropic"),
  chat("gemini", "Gemini 2.5 Flash", "google/gemini-2.5-flash", 0.3, 2.5, "google"),
  chat("gemini-lite", "Gemini 2.5 Flash Lite", "google/gemini-2.5-flash-lite", 0.1, 0.4, "google"),
  chat("gemini-pro", "Gemini 2.5 Pro", "google/gemini-2.5-pro", 1.25, 10, "google"),
  chat("deepseek", "DeepSeek V3", "deepseek/deepseek-chat", 0.26, 1.03, "deepseek"),
  chat("llama", "Llama 3.3 70B", "meta-llama/llama-3.3-70b-instruct", 0.1, 0.32, "meta"),
  chat("gpt-6-astra", "GPT-6 Astra", "openai/gpt-6-astra", 10, 50, "openai", PRO_LIMITS),
  chat("gpt-6-sol", "GPT-6 Sol", "openai/gpt-6-sol", 2, 10, "openai", PRO_LIMITS),
  chat("gpt-5.4-pro", "GPT-5.4 Pro", "openai/gpt-5.4-pro", 30, 180, "openai", PRO_LIMITS),
  chat("gpt-5.2-pro", "GPT-5.2 Pro", "openai/gpt-5.2-pro", 21, 168, "openai", PRO_LIMITS),
  chat("gpt-5-pro", "GPT-5 Pro", "openai/gpt-5-pro", 15, 120, "openai", PRO_LIMITS),
  chat("o3-pro", "o3 Pro", "openai/o3-pro", 20, 80, "openai", PRO_LIMITS),
  chat("claude-fable-5.1", "Claude Fable 5.1", "anthropic/claude-fable-5.1", 10, 50, "anthropic", PRO_LIMITS),
  chat("claude-opus-5", "Claude Opus 5", "anthropic/claude-opus-5", 5, 25, "anthropic", PRO_LIMITS),
  chat("claude-opus-5.5", "Claude Opus 5.5", "anthropic/claude-opus-5.5", 4, 20, "anthropic", PRO_LIMITS),
  chat("gpt-5.4", "GPT-5.4", "openai/gpt-5.4", 2.5, 15, "openai", PRO_LIMITS),
  chat("gpt-5.2", "GPT-5.2", "openai/gpt-5.2", 1.75, 14, "openai", PRO_LIMITS),
  chat("gpt-5.6-sol", "GPT-5.6 Sol", "openai/gpt-5.6-sol", 4, 20, "openai", PRO_LIMITS),
  chat("gpt-5.6-terra", "GPT-5.6 Terra", "openai/gpt-5.6-terra", 2, 12, "openai", PRO_LIMITS),
  chat("gemini-3.1-pro", "Gemini 3.1 Pro (preview)", "google/gemini-3.1-pro-preview", 2, 12, "google", PRO_LIMITS),
  chat("claude-sonnet-5", "Claude Sonnet 5", "anthropic/claude-sonnet-5", 2, 10, "anthropic", PRO_LIMITS),
  chat("claude-sonnet-5.5", "Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5", 2, 10, "anthropic", PRO_LIMITS),

  // Image: supported OpenAI Images API model.
  {
    // gpt-image-1 shut down on 2026-10-23; never sell the retired endpoint.
    slug: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    modality: "image",
    provider: "openai",
    upstreamModelId: "gpt-image-1.5",
    cost: { kind: "per_image", usd: 0.07 },
    costSource: "static",
    limits: { maxPromptChars: 4000, maxImages: 4 },
    enabled: true,
    description: "OpenAI gpt-image-1.5 (medium quality) text-to-image via the OpenAI Images API.",
    tags: ["image", "openai"],
    image: { sizeParam: "openai", sizes: ["1024x1024", "1024x1536", "1536x1024"] },
  },

  // Voice
  {
    slug: "gpt-audio-mini",
    displayName: "GPT Audio Mini",
    modality: "voice",
    provider: "openrouter",
    upstreamModelId: "openai/gpt-audio-mini",
    cost: { kind: "per_1k_chars", usd: 0.004 },
    costSource: "static",
    limits: { maxPromptChars: 2000 },
    enabled: true,
    description: "OpenAI GPT Audio Mini speech output through OpenRouter.",
    tags: ["voice", "openai"],
    voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    audioFormats: ["wav"],
  },
  {
    slug: "gpt-audio",
    displayName: "GPT Audio",
    modality: "voice",
    provider: "openrouter",
    upstreamModelId: "openai/gpt-audio",
    cost: { kind: "per_1k_chars", usd: 0.08 },
    costSource: "static",
    limits: { maxPromptChars: 2000 },
    enabled: true,
    description: "OpenAI GPT Audio speech output through OpenRouter.",
    tags: ["voice", "openai"],
    voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    audioFormats: ["wav"],
  },
  {
    slug: "tts-1",
    displayName: "OpenAI TTS-1",
    modality: "voice",
    provider: "openai",
    upstreamModelId: "tts-1",
    cost: { kind: "per_1k_chars", usd: 0.015 },
    costSource: "static",
    limits: { maxPromptChars: 4096 },
    enabled: true,
    description: "OpenAI tts-1 text-to-speech via the OpenAI Audio API.",
    tags: ["voice", "openai"],
    voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
  },
  {
    slug: "tts-1-hd",
    displayName: "OpenAI TTS-1 HD",
    modality: "voice",
    provider: "openai",
    upstreamModelId: "tts-1-hd",
    cost: { kind: "per_1k_chars", usd: 0.03 },
    costSource: "static",
    limits: { maxPromptChars: 4096 },
    enabled: true,
    description: "OpenAI tts-1-hd text-to-speech via the OpenAI Audio API.",
    tags: ["voice", "openai"],
    voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
  },
  {
    slug: "eleven-multilingual",
    displayName: "ElevenLabs Multilingual v2",
    modality: "voice",
    provider: "elevenlabs",
    upstreamModelId: "eleven_multilingual_v2",
    cost: { kind: "per_1k_chars", usd: 0.3 },
    costSource: "static",
    limits: { maxPromptChars: 2500 },
    enabled: true,
    description: "ElevenLabs eleven_multilingual_v2 text-to-speech. `voice` takes an ElevenLabs voice id.",
    tags: ["voice", "elevenlabs"],
    audioFormats: ["mp3"],
  },


];

export type AvailabilityCheck = (model: ModelDefinition) => boolean;

export class ModelRegistry {
  private models: Map<string, ModelDefinition> = new Map();
  /** Slugs whose upstream model id could not be found at the provider. */
  private unverified = new Map<string, string>();
  private verified = new Set<string>();
  private availability: AvailabilityCheck = () => true;

  constructor(initialModels: ModelDefinition[] = INITIAL_MODELS) {
    for (const model of initialModels) {
      this.registerModel(structuredClone(model));
    }
  }

  registerModel(model: ModelDefinition): void {
    this.models.set(model.slug.toLowerCase(), model);
  }

  setAvailabilityCheck(check: AvailabilityCheck): void {
    this.availability = check;
  }

  markUnverified(slug: string, reason: string): void {
    this.unverified.set(slug.toLowerCase(), reason);
  }

  clearUnverified(slug: string): void {
    this.unverified.delete(slug.toLowerCase());
    this.verified.add(slug.toLowerCase());
  }

  wasVerified(slug: string): boolean {
    return this.verified.has(slug.toLowerCase());
  }

  getUnavailableReason(model: ModelDefinition): string | null {
    if (!model.enabled) return "disabled";
    const unverified = this.unverified.get(model.slug.toLowerCase());
    if (unverified) return unverified;
    if (!this.availability(model)) return `provider '${model.provider}' is not configured`;
    return null;
  }

  getModel(slug: string): ModelDefinition | undefined {
    return this.models.get(slug.toLowerCase());
  }

  /** A model is sellable only when it is enabled, its provider is configured and its upstream id was verified. */
  isAvailable(model: ModelDefinition): boolean {
    return this.getUnavailableReason(model) === null;
  }

  getEnabledModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => this.isAvailable(m));
  }

  getModelsByModality(modality: ModelModality): ModelDefinition[] {
    return this.getEnabledModels().filter((m) => m.modality === modality);
  }

  getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }
}

export const defaultModelRegistry = new ModelRegistry();
