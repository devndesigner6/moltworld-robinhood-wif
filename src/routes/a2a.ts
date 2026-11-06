import { A2A_PROTOCOL_VERSION, AgentCard, Role } from "@a2a-js/sdk";
import {
  AgentEvent, AgentExecutor, DefaultRequestHandler, ExecutionEventBus,
  InMemoryTaskStore, JsonRpcTransportHandler, RequestContext, ServerCallContext,
} from "@a2a-js/sdk/server";
import { config } from "../config.js";
import { defaultModelRegistry, getModelDiscoveryDescription, getModelEndpoint } from "../models/registry.js";
import { quoteRequest, referenceRequest } from "../pricing/index.js";

const fromMicro = (m: Parameters<typeof referenceRequest>[0]) => quoteRequest(m, referenceRequest(m));

const origin = config.publicDomain.replace(/\/+$/, "");

export function getAgentCard(): AgentCard {
  const robinhood = config.paymentChain === "robinhood";
  return {
    name: "Moltworld Model Catalog Agent",
    description: robinhood
      ? "Finds chat models enabled for WIF payments on Robinhood Chain and returns their x402 endpoints. Exact WIF amounts are quoted for each request body. This A2A agent is discovery-only; it never signs or pays."
      : "Finds Moltworld AI models and explains their Algorand USDC x402 prices and endpoints. For paid inference, use the x402 endpoint or Moltworld MCP tools with a caller-authorized payment signature.",
    supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: A2A_PROTOCOL_VERSION, tenant: "" }],
    provider: { organization: "Moltworld", url: origin },
    version: "1.0.0",
    documentationUrl: `${origin}/llms.txt`,
    iconUrl: `${origin}/logo.png`,
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {}, securityRequirements: [],
    defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"],
    skills: [{ id: "find_models", name: "Find AI models", description: robinhood
      ? "Find chat models currently enabled on the WIF rail and return x402 endpoints plus a USD reference estimate; POST /v1/quote for the exact body-specific WIF amount."
      : "Find live chat, image, voice, and video models and return their x402 paid endpoints and USDC prices.",
      tags: robinhood ? ["model-discovery", "robinhood-chain", "wif", "x402"] : ["model-discovery", "algorand", "x402"],
      examples: robinhood ? ["List enabled chat models", "What is the cheapest chat model?", "How do I pay for GPT-4o in WIF?"] : ["List image models", "What is the cheapest chat model?", "How do I pay for GPT-4o?"],
      inputModes: ["text/plain"], outputModes: ["text/plain"], securityRequirements: [] }],
    signatures: [],
  };
}

const executor: AgentExecutor = {
  async execute(context: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const question = context.userMessage.parts
      .filter((part) => part.content?.$case === "text")
      .map((part) => part.content?.$case === "text" ? part.content.value : "")
      .join(" ").trim().toLowerCase();
    const models = defaultModelRegistry.getEnabledModels().filter((model) => config.paymentChain !== "robinhood" || model.modality === "chat");
    const modality = (["chat", "image", "voice", "video"] as const).find((value) => question.includes(value));
    const named = models.find((model) => question.includes(model.slug.toLowerCase()));
    const matches = named ? [named] : models.filter((model) => !modality || model.modality === modality);
    if (question.includes("cheap") || question.includes("lowest price")) {
      matches.sort((a, b) => fromMicro(a).microUsdc - fromMicro(b).microUsdc);
    }
    const shown = matches.slice(0, 10);
    const lines = [
      config.paymentChain === "robinhood"
        ? `${matches.length} matching enabled models. WIF amounts depend on the request body; POST /v1/quote returns the exact WIF amount before paying.`
        : `${matches.length} matching Moltworld models. Prices depend on the request body; POST /v1/quote gives the exact amount before paying.`,
      ...shown.map((model) => `${model.displayName} (${model.slug}): from ${fromMicro(model).formattedPrice} ${config.paymentChain === "robinhood" ? "USD reference estimate" : "USDC"}; POST ${origin}${getModelEndpoint(model)}. ${getModelDiscoveryDescription(model)}`),
      ...(matches.length > shown.length ? [`More: ${origin}/v1/models`] : []),
      config.paymentChain === "robinhood"
        ? `Payment: WIF on Robinhood Chain ${config.isMainnet ? "Mainnet" : "Testnet"} (${config.networkCaip2}) via x402 exact/Permit2. This discovery agent does not authorize payments. MCP: ${origin}/mcp`
        : `Payment: Algorand ${config.isMainnet ? "Mainnet" : "Testnet"} USDC via x402 and GoPlausible. MCP: ${origin}/mcp`,
    ];
    bus.publish(AgentEvent.message({
      role: Role.ROLE_AGENT, messageId: crypto.randomUUID(), contextId: context.contextId,
      taskId: "", parts: [{ content: { $case: "text", value: lines.join("\n") }, mediaType: "text/plain", filename: "", metadata: undefined }],
      metadata: undefined, extensions: [], referenceTaskIds: [],
    }));
  },
  async cancelTask(): Promise<void> {},
};

const requestHandler = new DefaultRequestHandler(getAgentCard(), new InMemoryTaskStore(), executor);
const transport = new JsonRpcTransportHandler(requestHandler);

export async function handleA2a(request: Request): Promise<Response> {
  const version = request.headers.get("A2A-Version") ?? A2A_PROTOCOL_VERSION;
  if (version !== A2A_PROTOCOL_VERSION) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32600, message: `Unsupported A2A version: ${version}` }, id: null }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > 64_000) return new Response("Request too large", { status: 413 });
  const body = await request.text();
  if (body.length > 64_000) return new Response("Request too large", { status: 413 });
  const result = await transport.handle(body, new ServerCallContext({ requestedVersion: version }));
  if (Symbol.asyncIterator in Object(result)) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Streaming is not supported" }, id: null });
  }
  return Response.json(result, { headers: { "A2A-Version": A2A_PROTOCOL_VERSION } });
}
