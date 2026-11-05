import { createMcpHandler, hostHeaderValidationResponse, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { config } from "../config.js";
import { defaultModelRegistry, getModelDiscoveryDescription, getModelEndpoint } from "../models/registry.js";
import { quoteRequest, referenceRequest } from "../pricing/index.js";

const origin = config.publicDomain;

/**
 * Remote MCP server. It never holds keys: paid calls need a Payment-Signature the
 * caller's own x402 wallet produced. For agents that should pay on their own, the
 * Moltworld SDK ships a local MCP server that signs within spend limits.
 */
export function createMcpRoute(gatewayFetch: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const callJson = async (path: string, init?: RequestInit) => {
    const res = await gatewayFetch(new Request(`${origin}${path}`, init));
    return { status: res.status, headers: res.headers, body: await res.text() };
  };

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "moltworld", version: "3.0.0" });

    server.registerTool(
      "list_models",
      {
        description: "List available Moltworld chat, image, voice and video models with their 'from' USDC price and x402 endpoint.",
        inputSchema: z.object({ modality: z.enum(["chat", "image", "voice", "video"]).optional() }),
      },
      async ({ modality }) =>
        text(
          defaultModelRegistry
            .getEnabledModels()
            .filter((m) => !modality || m.modality === modality)
            .map((m) => ({
              slug: m.slug,
              name: m.displayName,
              modality: m.modality,
              upstream: m.upstreamModelId,
              fromPrice: quoteRequest(m, referenceRequest(m)).formattedPrice,
              endpoint: `${origin}${getModelEndpoint(m)}`,
              description: getModelDiscoveryDescription(m),
              limits: m.limits,
            }))
        )
    );

    server.registerTool(
      "quote_request",
      {
        description: "Exact USDC price for a request body, without paying. Same amount the 402 challenge will ask for.",
        inputSchema: z.object({ model: z.string().min(1), body: z.record(z.string(), z.unknown()) }),
      },
      async ({ model, body }) => {
        const res = await callJson("/v1/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, model }),
        });
        return { isError: res.status !== 200, ...text(JSON.parse(res.body)) };
      }
    );

    server.registerTool(
      "get_payment_requirements",
      {
        description: "Get the live HTTP 402 x402 payment challenge (Payment-Required header) for a model and request body.",
        inputSchema: z.object({ model: z.string().min(1), body: z.record(z.string(), z.unknown()) }),
      },
      async ({ model: slug, body }) => {
        const model = defaultModelRegistry.getModel(slug);
        if (!model) return { isError: true, ...text({ error: `Unknown model '${slug}'.` }) };
        const res = await callJson(getModelEndpoint(model), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          isError: res.status !== 402,
          ...text({
            endpoint: `${origin}${getModelEndpoint(model)}`,
            status: res.status,
            paymentRequired: res.headers.get("Payment-Required"),
            quote: res.headers.get("Moltworld-Quote"),
            error: res.status !== 402 ? JSON.parse(res.body || "{}") : undefined,
          }),
        };
      }
    );

    server.registerTool(
      "submit_signed_request",
      {
        description:
          "Submit a model request with a Payment-Signature produced by the caller's Algorand x402 wallet for exactly this body. Never pays on its own.",
        inputSchema: z.object({ model: z.string().min(1), body: z.record(z.string(), z.unknown()), paymentSignature: z.string().min(1) }),
      },
      async ({ model: slug, body, paymentSignature }) => {
        const model = defaultModelRegistry.getModel(slug);
        if (!model) return { isError: true, ...text({ error: `Unknown model '${slug}'.` }) };
        const res = await callJson(getModelEndpoint(model), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Payment-Signature": paymentSignature },
          body: JSON.stringify(body),
        });
        return {
          isError: res.status >= 400,
          ...text({
            status: res.status,
            body: res.body.slice(0, 100_000),
            receipt: res.headers.get("Moltworld-Receipt"),
            paymentResponse: res.headers.get("Payment-Response"),
            requestId: res.headers.get("Moltworld-Request-Id"),
          }),
        };
      }
    );

    server.registerTool(
      "get_job",
      { description: "Status of a paid video job, including the video URL once ready and any refund.", inputSchema: z.object({ jobId: z.string().min(1) }) },
      async ({ jobId }) => {
        const res = await callJson(`/v1/jobs/${encodeURIComponent(jobId)}`);
        return { isError: res.status !== 200, ...text(JSON.parse(res.body)) };
      }
    );

    server.registerTool(
      "get_receipt",
      { description: "Signed receipt, settlement txid, rebate and refund status of a paid request.", inputSchema: z.object({ requestId: z.string().min(1) }) },
      async ({ requestId }) => {
        const res = await callJson(`/v1/receipts/${encodeURIComponent(requestId)}`);
        return { isError: res.status !== 200, ...text(JSON.parse(res.body)) };
      }
    );

    return server;
  });

  return function handleMcp(request: Request): Promise<Response> {
    const hostname = new URL(origin).hostname;
    const rejected = hostHeaderValidationResponse(request, [hostname, "localhost", "127.0.0.1"]);
    return rejected ? Promise.resolve(rejected) : handler.fetch(request);
  };
}
