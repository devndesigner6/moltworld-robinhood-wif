import { ModelDefinition } from "../models/registry.js";
import { config } from "../config.js";
import type {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
} from "../providers/types.js";

export interface PriceQuote {
  modelSlug: string;
  modality: string;
  /** Units the quote was computed from, so a client can audit it. */
  units: {
    estimatedInputTokens?: number;
    maxOutputTokens?: number;
    images?: number;
    characters?: number;
    seconds?: number;
  };
  costBasis: ModelDefinition["cost"];
  costSource: ModelDefinition["costSource"];
  upstreamCostUsd: number;
  marginPercent: number;
  finalPriceUsd: number;
  formattedPrice: string;
  microUsdc: number;
}

export type ValidatedRequest =
  | ChatCompletionRequest
  | ImageGenerationRequest
  | AudioSpeechRequest
  | VideoGenerationRequest;

const MICRO = 1_000_000;

/**
 * Conservative token estimate: one token per three UTF-8 bytes plus per-message
 * framing. Byte-based counting keeps CJK and emoji-heavy prompts from being
 * under-quoted the way a characters/4 heuristic would.
 */
export function estimateInputTokens(messages: { content: string }[]): number {
  const bytes = messages.reduce((acc, m) => acc + Buffer.byteLength(m.content, "utf8"), 0);
  return Math.ceil(bytes / 3) + messages.length * 8 + 4;
}

export function microToUsdString(micro: number): string {
  const whole = Math.floor(micro / MICRO);
  const frac = String(micro % MICRO).padStart(6, "0").replace(/0+$/, "");
  return frac ? `$${whole}.${frac}` : `$${whole}`;
}

export function usdToMicroCeil(usd: number): number {
  // Round away float noise before taking the ceiling (0.1 + 0.2 style artifacts).
  return Math.ceil(Number((usd * MICRO).toFixed(4)));
}

export function priceFromCost(upstreamCostUsd: number, margin = config.priceMargin): { microUsdc: number; usd: number } {
  const floorMicro = usdToMicroCeil(config.priceMinFloor);
  const microUsdc = Math.max(floorMicro, usdToMicroCeil(upstreamCostUsd * (1 + margin)));
  return { microUsdc, usd: microUsdc / MICRO };
}

/**
 * Upstream cost of a request in USD. For chat this is the worst case (the full
 * max_tokens budget); the difference to actual usage is rebated after the call.
 */
export function upstreamCostFor(model: ModelDefinition, request: ValidatedRequest): { usd: number; units: PriceQuote["units"] } {
  const cost = model.cost;
  switch (model.modality) {
    case "chat": {
      const req = request as ChatCompletionRequest;
      if (cost.kind !== "tokens") throw new Error(`Chat model ${model.slug} needs a token cost basis.`);
      const estimatedInputTokens = estimateInputTokens(req.messages);
      const maxOutputTokens = req.max_tokens ?? model.limits.maxOutputTokens ?? 1024;
      const usd =
        (estimatedInputTokens * cost.inputPerMillionUsd + maxOutputTokens * cost.outputPerMillionUsd) / 1_000_000;
      return { usd, units: { estimatedInputTokens, maxOutputTokens } };
    }
    case "image": {
      const req = request as ImageGenerationRequest;
      if (cost.kind !== "per_image") throw new Error(`Image model ${model.slug} needs a per-image cost basis.`);
      const images = req.n ?? 1;
      return { usd: images * cost.usd, units: { images } };
    }
    case "voice": {
      const req = request as AudioSpeechRequest;
      if (cost.kind !== "per_1k_chars") throw new Error(`Voice model ${model.slug} needs a per-character cost basis.`);
      const characters = req.input.length;
      return { usd: (characters / 1000) * cost.usd, units: { characters } };
    }
    case "video": {
      const req = request as VideoGenerationRequest;
      if (cost.kind !== "per_second") throw new Error(`Video model ${model.slug} needs a per-second cost basis.`);
      const seconds = req.duration ?? model.video?.durations[0] ?? 5;
      return { usd: seconds * cost.usd, units: { seconds } };
    }
  }
}

/** Price a validated request. Deterministic: the 402 challenge and the paid retry produce the same amount. */
export function quoteRequest(model: ModelDefinition, request: ValidatedRequest): PriceQuote {
  const { usd, units } = upstreamCostFor(model, request);
  const price = priceFromCost(usd);
  return {
    modelSlug: model.slug,
    modality: model.modality,
    units,
    costBasis: model.cost,
    costSource: model.costSource,
    upstreamCostUsd: Number(usd.toFixed(6)),
    marginPercent: Math.round(config.priceMargin * 100),
    finalPriceUsd: price.usd,
    formattedPrice: microToUsdString(price.microUsdc),
    microUsdc: price.microUsdc,
  };
}

/** The price of a small, typical request; shown in catalogs as a "from" price. */
export function referenceRequest(model: ModelDefinition): ValidatedRequest {
  switch (model.modality) {
    case "chat":
      return { messages: [{ role: "user", content: "Hello! Summarize Algorand in one sentence." }], max_tokens: 256 };
    case "image":
      return { prompt: "A lighthouse at dawn", n: 1 };
    case "voice":
      return { input: "Welcome to Moltworld, pay-per-request AI on Algorand." };
    case "video":
      return { prompt: "Waves at sunset", duration: model.video?.durations[0] ?? 5 };
  }
}

/**
 * Price for what a chat call actually consumed. Used to rebate the unused part of
 * the max_tokens budget the caller was charged up front.
 */
export function actualChatPriceMicro(
  model: ModelDefinition,
  usage: { prompt_tokens: number; completion_tokens: number },
  reportedUpstreamCostUsd?: number
): number {
  if (model.cost.kind !== "tokens") throw new Error("actualChatPriceMicro needs a token cost basis.");
  const computed =
    (usage.prompt_tokens * model.cost.inputPerMillionUsd + usage.completion_tokens * model.cost.outputPerMillionUsd) /
    1_000_000;
  // When the upstream reports its own billed cost (OpenRouter does), trust the higher of the two.
  const usd = Math.max(computed, reportedUpstreamCostUsd ?? 0);
  return priceFromCost(usd).microUsdc;
}
