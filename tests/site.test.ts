import { describe, expect, it } from "vitest";
import { SITE_JS } from "../src/site/script.js";
import { WORLD_JS } from "../src/site/world.js";
import { FLOW_JS } from "../src/site/flow.js";
import { quoteWidget } from "../src/site/widgets.js";

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

  it("scene modules parse", () => {
    for (const source of [WORLD_JS, FLOW_JS]) {
      expect(() => new Function(source.replace(/^export /gm, ""))).not.toThrow();
    }
  });
});
