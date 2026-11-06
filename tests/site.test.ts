import { describe, expect, it } from "vitest";
import { SITE_JS } from "../src/site/script.js";
import { WORLD_JS } from "../src/site/world.js";
import { FLOW_JS } from "../src/site/flow.js";
import { quoteWidget } from "../src/site/widgets.js";
import { Hono } from "hono";
import { registerSite } from "../src/site/pages.js";

// The client scripts are strings served as-is, so a syntax slip only shows up in a browser.
describe("site scripts", () => {
  it("site.js parses", () => {
    expect(() => new Function(SITE_JS)).not.toThrow();
  });

  it("keeps paid answers separate from quote and 402 diagnostics", () => {
    const html = quoteWidget();
    expect(html).toContain('id="runOut"');
    expect(html).toContain('id="quoteOut"');
    expect(html.indexOf('id="runOut"')).toBeLessThan(html.indexOf('id="quoteOut"'));
    expect(SITE_JS).toContain('let quoteSeq = 0, runSeq = 0, debounce = 0;');
    expect(SITE_JS).toContain('showRunOutput(renderResult(m, result.data), renderReceipt(result));');
  });

  it("keeps sub-cent WIF ledger quotes visible and renders ledger-derived summary metrics", () => {
    expect(SITE_JS).toContain('const digits = Math.abs(num) >= 1 ? 2 : 6');
    expect(SITE_JS).toContain('set("sAvgTicket", fmtUsd(s.avg_ticket_usd_quote), true)');
    expect(SITE_JS).toContain('s.avg_settle_ms != null');
  });

  it("serves the local MetaMask logo as a PNG asset", async () => {
    const app = new Hono();
    registerSite(app);
    const response = await app.request("/assets/wallets/metamask.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("scene modules parse", () => {
    for (const source of [WORLD_JS, FLOW_JS]) {
      expect(() => new Function(source.replace(/^export /gm, ""))).not.toThrow();
    }
  });
});
