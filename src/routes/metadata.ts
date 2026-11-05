import { Context } from "hono";
import { config } from "../config.js";
import { defaultModelRegistry, getModelEndpoint, getModelDiscoveryDescription } from "../models/registry.js";
import { quoteRequest, referenceRequest } from "../pricing/index.js";

const SITE_TITLE = "Moltworld | Multimodal AI Gateway with x402 on Algorand";
const SITE_DESCRIPTION =
  "One API for AI models and autonomous agents. Chat, image and voice requests are paid per call in USDC on Algorand.";
const SERVICE_TAGS = ["moltworld", "ai-inference", "algorand", "x402", "x402-global-challenge"];

function siteUrl(): string {
  return config.publicDomain.replace(/\/+$/, "");
}

function fromQuote(model: Parameters<typeof referenceRequest>[0]) {
  return quoteRequest(model, referenceRequest(model));
}

export function handleX402Discovery(c: Context): Response {
  const origin = siteUrl();
  return c.json(
    {
      x402Version: 2,
      name: SITE_TITLE,
      description: SITE_DESCRIPTION,
      website: origin,
      logo: `${origin}/logo.png`,
      image: `${origin}/logo.png`,
      tags: SERVICE_TAGS,
      resources: defaultModelRegistry.getEnabledModels().map((model) => ({
        url: `${origin}${getModelEndpoint(model)}`,
        method: "POST",
        description: getModelDiscoveryDescription(model),
        network: config.networkCaip2,
        asset: config.usdcAsaId,
        amount: String(fromQuote(model).microUsdc),
        pricing: "dynamic: amount shown is for a reference request; POST /v1/quote prices an exact body",
        payTo: config.payToAddress,
        tags: [...SERVICE_TAGS, model.modality],
      })),
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}

export function handleLlmsTxt(c: Context): Response {
  const origin = siteUrl();
  const network = config.isMainnet ? "Algorand Mainnet" : "Algorand Testnet";
  const lines = [
    `# ${SITE_TITLE}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `Site: ${origin}/`,
    `Docs: ${config.docsUrl}`,
    `Logo: ${origin}/logo.png`,
    `Merchant payTo address: ${config.payToAddress}`,
    `Payment: x402 exact scheme; USDC on ${network} (ASA ${config.usdcAsaId}; network ${config.networkCaip2}).`,
    `Facilitator: ${config.facilitatorUrl} (GoPlausible).`,
    "Discovery: GoPlausible Bazaar; challenge tag: x402-global-challenge.",
    "",
    "## Agent guidance",
    "",
    "- Read the live model catalog for current availability, prices, descriptions, and endpoint paths.",
    "- Prices are per request and depend on the body (input size and max_tokens for chat, images, characters, seconds). POST /v1/quote returns the exact amount for a body without paying.",
    "- Send JSON to a model's POST endpoint. Invalid bodies get HTTP 400 before any payment. A valid unpaid request returns HTTP 402 with a Payment-Required header for that exact body.",
    "- Pay with an x402 client that supports Algorand USDC and retry with Payment-Signature. Each paid response carries a Moltworld-Receipt header: an Ed25519-signed receipt binding the txid to sha256 of your request and of the response body.",
    "- Chat settles after the answer is produced; unused max_tokens budget is rebated in USDC. Image and voice settle first and are refunded on-chain if the upstream fails. Historical video job records remain available at /v1/jobs/{id}.",
    "- Retrying with the same Payment-Signature after a dropped connection returns the original response; it is never charged twice.",
    "- Agents can pay through an on-chain spending mandate (delegated LogicSig) with per-call, daily and model limits: see /v1/mandates/draft. Every mandate is bound to the agent's own key (`moltworld-mcp keygen`): each payment carries the agent's ed25519 signature over its txid as LogicSig arg 0, so the credential alone cannot pay.",
    ...(config.mandateCounterAppId
      ? [`- Mandates here are capped on-chain: each payment is grouped with a call to the immutable spend counter app ${config.mandateCounterAppId} (args: "spend", salt, cap, window), which rejects spend over the cap per window.`]
      : []),
    "- Choose a model that matches the requested modality and respect the input limits in the catalog and payment response.",
    "",
    "## Discovery and service links",
    "",
    `- [Moltworld home](${origin}/): Service overview and logo.`,
    `- [x402 service descriptor](${origin}/.well-known/x402): Machine-readable paid route and payment catalog.`,
    `- [A2A agent card](${origin}/.well-known/agent-card.json): Working JSON-RPC model discovery agent at ${origin}/a2a.`,
    `- [MCP server](${origin}/mcp): Model catalog, live payment requirements, and caller-signed paid requests.`,
    `- [Live model catalog](${origin}/v1/models): Enabled models, prices, descriptions, and endpoint paths in JSON.`,
    `- [Service health](${origin}/health): Network, asset, payTo address, and facilitator context.`,
    `- [Quote](${origin}/v1/quote): POST { model, ...body } for the exact price of a request.`,
    `- [Receipt keys](${origin}/.well-known/moltworld-receipts.json): Ed25519 keys that sign Moltworld receipts.`,
    `- [Public stats](${origin}/v1/stats): Ledger metrics with on-chain txids.`,
    `- [Marketplace](${origin}/v1/market): Creator APIs sold through Moltworld's x402 checkout.`,
    `- [GoPlausible Bazaar resources](${config.facilitatorUrl}/discovery/resources): Facilitator catalog of settled x402 resources.`,
    `- [GoPlausible Bazaar merchants](${config.facilitatorUrl}/discovery/merchants): Facilitator merchant catalog; find the payTo address above.`,
    "",
    "## Paid model endpoints",
    "",
  ];

  for (const modality of ["chat", "image", "voice", "video"] as const) {
    const models = defaultModelRegistry.getEnabledModels().filter((model) => model.modality === modality);
    lines.push(`### ${modality[0].toUpperCase()}${modality.slice(1)}`, "");
    for (const model of models) {
      lines.push(
        `- [${model.displayName}](${origin}${getModelEndpoint(model)}): POST; from ${fromQuote(model).formattedPrice} USDC. ${getModelDiscoveryDescription(model)}`
      );
    }
    lines.push("");
  }

  return c.text(lines.join("\n"), 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
}
