import { ModelDefinition } from "../models/registry.js";
import {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ChatMessage,
  ImageGenerationRequest,
  VideoGenerationRequest,
} from "../providers/types.js";

export type ValidationResult<T> = { valid: true; request: T } | { valid: false; error: string };

const VALID_ROLES = new Set(["system", "user", "assistant"]);
const DEFAULT_MAX_TOKENS = 1024;

function isObject(body: unknown): body is Record<string, any> {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

function requirePrompt(body: Record<string, any>, field: string, maxChars: number): string | { error: string } {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    return { error: `Field '${field}' is required and must be a non-empty string.` };
  }
  if (value.length > maxChars) {
    return { error: `Field '${field}' exceeds the model limit of ${maxChars} characters.` };
  }
  return value.trim();
}

export function validateChatBody(body: unknown, model: ModelDefinition): ValidationResult<ChatCompletionRequest> {
  if (!isObject(body)) return { valid: false, error: "Request body must be a JSON object." };
  if (body.stream === true) {
    return { valid: false, error: "Streaming is not supported; omit 'stream' or set it to false." };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { valid: false, error: "Field 'messages' must be a non-empty array." };
  }
  const maxMessages = model.limits.maxMessages ?? 50;
  if (body.messages.length > maxMessages) {
    return { valid: false, error: `Too many messages: ${body.messages.length} (limit ${maxMessages}).` };
  }

  const maxChars = model.limits.maxPromptChars ?? 32000;
  const messages: ChatMessage[] = [];
  let totalChars = 0;
  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (!isObject(msg)) return { valid: false, error: `Message at index ${i} must be an object.` };
    if (!VALID_ROLES.has(msg.role)) {
      return { valid: false, error: `Message at index ${i} has invalid role '${msg.role}'. Valid roles: system, user, assistant.` };
    }
    if (typeof msg.content !== "string" || msg.content.trim().length === 0) {
      return { valid: false, error: `Message at index ${i} must have a non-empty string 'content'.` };
    }
    totalChars += msg.content.length;
    if (totalChars > maxChars) {
      return { valid: false, error: `Combined prompt length exceeds the limit of ${maxChars} characters.` };
    }
    messages.push({ role: msg.role, content: msg.content });
  }

  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || Number.isNaN(body.temperature) || body.temperature < 0 || body.temperature > 2) {
      return { valid: false, error: "Field 'temperature' must be a number between 0 and 2." };
    }
    temperature = body.temperature;
  }

  // max_tokens is always sent upstream, so the caller can never consume more than was quoted.
  const outputLimit = model.limits.maxOutputTokens ?? 2048;
  let maxTokens = Math.min(DEFAULT_MAX_TOKENS, outputLimit);
  if (body.max_tokens !== undefined) {
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
      return { valid: false, error: "Field 'max_tokens' must be a positive integer." };
    }
    if (body.max_tokens > outputLimit) {
      return { valid: false, error: `Requested max_tokens (${body.max_tokens}) exceeds the model limit of ${outputLimit}.` };
    }
    maxTokens = body.max_tokens;
  }

  return { valid: true, request: { messages, temperature, max_tokens: maxTokens } };
}

export function validateImageBody(body: unknown, model: ModelDefinition): ValidationResult<ImageGenerationRequest> {
  if (!isObject(body)) return { valid: false, error: "Request body must be a JSON object." };
  const prompt = requirePrompt(body, "prompt", model.limits.maxPromptChars ?? 4000);
  if (typeof prompt !== "string") return { valid: false, error: prompt.error };

  const maxImages = model.limits.maxImages ?? 1;
  let n = 1;
  if (body.n !== undefined) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > maxImages) {
      return { valid: false, error: `Field 'n' must be an integer between 1 and ${maxImages} for ${model.slug}.` };
    }
    n = body.n;
  }

  const sizes = model.image?.sizes ?? ["1024x1024"];
  let size = sizes[0];
  if (body.size !== undefined) {
    if (typeof body.size !== "string" || !sizes.includes(body.size)) {
      return { valid: false, error: `Invalid size '${body.size}'. Allowed for ${model.slug}: ${sizes.join(", ")}.` };
    }
    size = body.size;
  }

  return { valid: true, request: { prompt, n, size } };
}

const AUDIO_FORMATS = new Set(["mp3", "wav", "opus", "aac", "flac"]);

export function validateAudioBody(body: unknown, model: ModelDefinition): ValidationResult<AudioSpeechRequest> {
  if (!isObject(body)) return { valid: false, error: "Request body must be a JSON object." };
  const input = requirePrompt(body, "input", model.limits.maxPromptChars ?? 4096);
  if (typeof input !== "string") return { valid: false, error: input.error };

  let voice: string | undefined;
  if (body.voice !== undefined) {
    if (typeof body.voice !== "string" || body.voice.length === 0 || body.voice.length > 64) {
      return { valid: false, error: "Field 'voice' must be a non-empty string." };
    }
    if (model.voices && !model.voices.includes(body.voice)) {
      return { valid: false, error: `Invalid voice '${body.voice}'. Allowed for ${model.slug}: ${model.voices.join(", ")}.` };
    }
    voice = body.voice;
  }

  const formats = model.audioFormats ?? [...AUDIO_FORMATS];
  let format = formats[0] as AudioSpeechRequest["response_format"];
  if (body.response_format !== undefined) {
    if (!formats.includes(body.response_format)) {
      return { valid: false, error: `Field 'response_format' must be one of: ${formats.join(", ")} for ${model.slug}.` };
    }
    format = body.response_format;
  }

  let speed: number | undefined;
  if (body.speed !== undefined) {
    if (typeof body.speed !== "number" || body.speed < 0.25 || body.speed > 4) {
      return { valid: false, error: "Field 'speed' must be a number between 0.25 and 4.0." };
    }
    speed = body.speed;
  }

  return { valid: true, request: { input, voice, response_format: format, speed } };
}

export function validateVideoBody(body: unknown, model: ModelDefinition): ValidationResult<VideoGenerationRequest> {
  if (!isObject(body)) return { valid: false, error: "Request body must be a JSON object." };
  const prompt = requirePrompt(body, "prompt", model.limits.maxPromptChars ?? 2500);
  if (typeof prompt !== "string") return { valid: false, error: prompt.error };

  const spec = model.video;
  const durations = spec?.durations ?? [5];
  let duration = durations[0];
  if (body.duration !== undefined) {
    if (!durations.includes(body.duration)) {
      return { valid: false, error: `Field 'duration' must be one of ${durations.join(", ")} seconds for ${model.slug}.` };
    }
    duration = body.duration;
  }

  const ratios = spec?.aspectRatios ?? ["16:9"];
  let aspectRatio = ratios[0];
  if (body.aspect_ratio !== undefined) {
    if (!ratios.includes(body.aspect_ratio)) {
      return { valid: false, error: `Field 'aspect_ratio' must be one of ${ratios.join(", ")} for ${model.slug}.` };
    }
    aspectRatio = body.aspect_ratio;
  }

  return { valid: true, request: { prompt, duration, aspect_ratio: aspectRatio } };
}

export function validateBody(body: unknown, model: ModelDefinition) {
  switch (model.modality) {
    case "chat":
      return validateChatBody(body, model);
    case "image":
      return validateImageBody(body, model);
    case "voice":
      return validateAudioBody(body, model);
    case "video":
      return validateVideoBody(body, model);
  }
}
