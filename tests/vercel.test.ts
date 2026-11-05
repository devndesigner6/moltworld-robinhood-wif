import { afterEach, describe, expect, it, vi } from "vitest";
import serverlessApp from "../src/index.js";

describe("Vercel Render proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["/", "/v1/models?modality=chat", "/.well-known/moltworld-receipts.json"])(
    "proxies %s to the fixed Render service",
    async (path) => {
      const upstreamFetch = vi.fn(async () => new Response("live Render response", {
        status: 200,
        headers: { "Cache-Control": "public, max-age=60" },
      }));
      vi.stubGlobal("fetch", upstreamFetch);

      const response = await serverlessApp.request(path);
      const upstreamRequest = upstreamFetch.mock.calls[0]?.[0] as Request | undefined;

      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(`https://motoworld-wif.onrender.com${path}`);
      expect(await response.text()).toBe("live Render response");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });
