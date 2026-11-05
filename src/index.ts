import { Hono } from "hono";
import { app, init } from "./application.js";
import { assertProductionConfig } from "./config.js";

const serverlessApp = new Hono();
const renderOrigin = (process.env.RENDER_BACKEND_URL?.trim() || "https://motoworld-wif.onrender.com").replace(/\/$/, "");
let gatewayInitialization: Promise<void> | undefined;

function requiresGateway(pathname: string): boolean {
  return pathname === "/health"
    || pathname === "/v1"
    || pathname.startsWith("/v1/")
    || pathname === "/a2a"
    || pathname === "/mcp"
    || pathname === "/llms.txt"
    || pathname.startsWith("/.well-known/");
}

async function ensureGatewayReady(): Promise<void> {
  assertProductionConfig();
  gatewayInitialization ??= init().catch((error) => {
    gatewayInitialization = undefined;
    throw error;
  });
  await gatewayInitialization;
}

serverlessApp.all("*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  // Vercel reserves /.well-known and will not apply external rewrites to it.
  // Keep receipt-key and discovery paths on the same public Vercel origin by
  // proxying only to the fixed Render service (never a caller-selected host).
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) {
    const incoming = new URL(c.req.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, renderOrigin);
    return fetch(new Request(target, c.req.raw));
  }
  if (requiresGateway(pathname)) {
    if (process.env.ENABLE_LIVE_PAYMENTS !== "true") {
      return c.json({
        error: {
          code: "gateway_disabled",
          message: "Paid API endpoints are disabled until production configuration is complete.",
        },
      }, 503);
    }

    try {
      await ensureGatewayReady();
    } catch (error) {
      console.error("Vercel gateway initialization failed", error instanceof Error ? error.name : "unknown error");
      return c.json({
        error: {
          code: "gateway_unavailable",
          message: "The gateway is not ready. Check the production database, provider, and payment configuration.",
        },
      }, 503);
    }
  }

  return app.fetch(c.req.raw);
});

export default serverlessApp;
