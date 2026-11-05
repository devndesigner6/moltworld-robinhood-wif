import { describe, expect, it } from "vitest";
import { SITE_JS } from "../src/site/script.js";
import { WORLD_JS } from "../src/site/world.js";
import { FLOW_JS } from "../src/site/flow.js";

// The client scripts are strings served as-is, so a syntax slip only shows up in a browser.
describe("site scripts", () => {
  it("site.js parses", () => {
    expect(() => new Function(SITE_JS)).not.toThrow();
  });

  it("scene modules parse", () => {
    for (const source of [WORLD_JS, FLOW_JS]) {
      expect(() => new Function(source.replace(/^export /gm, ""))).not.toThrow();
    }
  });
});
