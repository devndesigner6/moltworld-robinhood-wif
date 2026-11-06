import { HTTPFacilitatorClient, x402ResourceServer, RouteConfig, RoutesConfig } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402-avm/extensions";
import {
  config,
  ALGORAND_TESTNET_FACILITATOR_CAIP2,
  ALGORAND_TESTNET_CANONICAL_CAIP2,
  ALGORAND_MAINNET_FACILITATOR_CAIP2,
  ALGORAND_MAINNET_CANONICAL_CAIP2,
} from "../config.js";
import { ModelRegistry, defaultModelRegistry, getModelEndpoint, getModelDiscoveryDescription, ModelDefinition } from "../models/registry.js";
import { paymentFlowFor, priceFromState, registerPaymentHooks } from "../payments/gateway.js";
import { WIF_CHAT_MAX_TIMEOUT_SECONDS } from "../payments/wif-challenges.js";

export function createX402Server(registry: ModelRegistry = defaultModelRegistry): {
  server: x402ResourceServer;
  routes: RoutesConfig;
} {
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const server = new x402ResourceServer(facilitatorClient);

  if (config.paymentChain === "robinhood") {
    server.register(config.networkCaip2, new ExactEvmScheme());
  } else {
    // The legacy facilitator advertises full-genesis-hash IDs; @x402/avm also uses truncated IDs.
    server.register(ALGORAND_TESTNET_FACILITATOR_CAIP2, new ExactAvmScheme());
    server.register(ALGORAND_TESTNET_CANONICAL_CAIP2, new ExactAvmScheme());
    server.register(ALGORAND_MAINNET_FACILITATOR_CAIP2, new ExactAvmScheme());
    server.register(ALGORAND_MAINNET_CANONICAL_CAIP2, new ExactAvmScheme());
    server.registerExtension(bazaarResourceServerExtension);
  }
  registerPaymentHooks(server);

  return { server, routes: buildX402Routes(registry) };
}

function discoveryFor(model: ModelDefinition) {
  switch (model.modality) {
    case "chat":
      return declareDiscoveryExtension({
        input: { messages: [{ role: "user", content: "Explain x402 payments in one paragraph." }], max_tokens: 300 },
        inputSchema: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              items: {
                type: "object",
                properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } },
                required: ["role", "content"],
              },
            },
            temperature: { type: "number", minimum: 0, maximum: 2 },
            max_tokens: { type: "integer", minimum: 1, maximum: model.limits.maxOutputTokens ?? 2048 },
          },
          required: ["messages"],
        },
        bodyType: "json",
        output: {
          example: {
            object: "chat.completion",
            model: model.slug,
            choices: [{ index: 0, message: { role: "assistant", content: "Algorand is a proof-of-stake blockchain..." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 14, completion_tokens: 120, total_tokens: 134 },
            moltworld: { request_id: "req_...", receipt_url: `${config.publicDomain}/v1/receipts/req_...` },
          },
        },
      });
    case "image":
      return declareDiscoveryExtension({
        input: { prompt: "A lighthouse on a cliff at dawn, watercolor", n: 1, size: model.image?.sizes[0] ?? "1024x1024" },
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", maxLength: model.limits.maxPromptChars ?? 3000 },
            n: { type: "integer", minimum: 1, maximum: model.limits.maxImages ?? 1 },
            size: { type: "string", enum: model.image?.sizes ?? ["1024x1024"] },
          },
          required: ["prompt"],
        },
        bodyType: "json",
        output: { example: { created: 1760000000, data: [{ url: "https://..." }], moltworld: { request_id: "req_..." } } },
      });
    case "voice":
      return declareDiscoveryExtension({
        input: { input: "Welcome to Moltworld.", ...(model.voices ? { voice: model.voices[0] } : {}) },
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string", maxLength: model.limits.maxPromptChars ?? 2000 },
            voice: model.voices ? { type: "string", enum: model.voices } : { type: "string" },
            response_format: { type: "string", enum: model.audioFormats ?? ["mp3", "wav", "opus", "aac", "flac"] },
          },
          required: ["input"],
        },
        bodyType: "json",
        output: {
          example: { object: "audio.speech", model: model.slug, format: model.audioFormats?.[0] ?? "mp3", audio_b64: "<base64>", character_count: 21 },
        },
      });
    case "video":
      return declareDiscoveryExtension({
        input: { prompt: "Slow aerial shot over ocean waves at sunset", duration: model.video?.durations[0] ?? 5 },
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", maxLength: model.limits.maxPromptChars ?? 2500 },
            duration: { type: "integer", enum: model.video?.durations ?? [5] },
            aspect_ratio: { type: "string", enum: model.video?.aspectRatios ?? ["16:9"] },
          },
          required: ["prompt"],
        },
        bodyType: "json",
        output: {
          example: { id: "job_...", object: "video.job", status: "queued", poll_url: `${config.publicDomain}/v1/jobs/job_...` },
        },
      });
  }
}

/**
 * One x402 route per catalog model (each with its own Bazaar schema) plus the
 * marketplace route. Routes exist for every model; whether a model is sellable is
 * decided per request before payment, so catalog sync can switch models on and off.
 */
export function buildX402Routes(registry: ModelRegistry): RoutesConfig {
  const routes: Record<string, RouteConfig> = {};
  for (const model of registry.getAllModels()) {
    const flow = paymentFlowFor(model);
    routes[`POST ${getModelEndpoint(model)}`] = {
      accepts: {
        scheme: "exact",
        price: priceFromState,
        network: config.networkCaip2,
        payTo: config.payToAddress,
        maxTimeoutSeconds: model.modality === "chat" ? WIF_CHAT_MAX_TIMEOUT_SECONDS : 300,
        extra: { tag: "x402-global-challenge", ...(flow === "upfront" ? { paymentFlow: "upfront" } : {}) },
      },
      resource: `${config.publicDomain}${getModelEndpoint(model)}`,
      description: getModelDiscoveryDescription(model),
      mimeType: "application/json",
      serviceName: "Moltworld",
      tags: model.tags,
      ...(config.paymentChain === "algorand" ? { extensions: { ...discoveryFor(model) } } : {}),
    };
  }
  routes["POST /v1/market/:slug/call"] = {
    accepts: {
      scheme: "exact",
      price: priceFromState,
      network: config.networkCaip2,
      payTo: config.payToAddress,
      maxTimeoutSeconds: 120,
      extra: { tag: "x402-global-challenge" },
    },
    description: "Call a creator API listed on the Moltworld marketplace. Price is set by the listing.",
    mimeType: "application/json",
    serviceName: "Moltworld Market",
  };
  return routes;
}
