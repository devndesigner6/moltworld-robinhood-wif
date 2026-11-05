// Renders the brand PNGs (app icon, favicons, social card) from the SVG mark and writes them to
// public/, docs/ and src/assets/images.ts.
//
//   node scripts/render-brand.mjs             # uses Playwright's bundled Chromium
//   CHROME_PATH=/path/to/chrome node scripts/render-brand.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ARCHES = "M5.5 23V14.5a4.25 4.25 0 0 1 8.5 0V23M14 14.5a4.25 4.25 0 0 1 8.5 0V23";
const INK = "#0A0A0B", PAPER = "#EDEBE6", MUTED = "#A3A09A", LINE = "#2F2F35", SIGNAL = "#3DDC97";
const markPath = (stroke) => `<path d="${ARCHES}" fill="none" stroke="${stroke}" stroke-width="3.2"/><circle cx="26.2" cy="20.9" r="2.1" fill="${SIGNAL}"/>`;

const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; background: transparent; }
  #og { width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 80px; background: ${INK}; color: ${PAPER}; font-family: Geist; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
  #og h1 { margin-bottom: 40px; }
  .wm { display: flex; align-items: center; gap: 16px; font-weight: 600; font-size: 40px; letter-spacing: -0.04em; }
  h1 { margin: 0; font-size: 92px; line-height: .95; letter-spacing: -0.05em; font-weight: 600; max-width: 15ch; }
  h1 span { display: block; color: ${MUTED}; }
  .ring { position: absolute; right: -120px; top: -60px; width: 620px; height: 620px; border-radius: 50%; border: 1px solid ${LINE}; }
  .ring::after { content: ""; position: absolute; inset: 90px; border-radius: 50%; border: 1px solid ${LINE}; }
  .dot { position: absolute; right: 150px; top: 150px; width: 26px; height: 26px; border-radius: 50%; background: ${SIGNAL}; }
</style></head><body>
<svg id="tile" width="512" height="512" viewBox="0 0 32 32"><rect width="32" height="32" rx="7.2" fill="${INK}"/>${markPath(PAPER)}</svg>
<div id="og"><div class="ring"></div><div class="dot"></div>
  <div class="wm"><svg width="54" height="33" viewBox="3.5 8.4 25 15">${markPath(PAPER)}</svg>moltworld</div>
  <h1>Every AI model, <span>paid per request.</span></h1>
</div></body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const shot = async (selector, opts = {}) => page.locator(selector).screenshot({ omitBackground: true, ...opts });
const og = await shot("#og");
const tile = {};
for (const size of [512, 256, 128, 32]) {
  await page.evaluate((s) => { const t = document.getElementById("tile"); t.setAttribute("width", s); t.setAttribute("height", s); }, size);
  tile[size] = await shot("#tile");
}
await browser.close();

const write = (rel, bytes) => fs.writeFileSync(path.join(ROOT, rel), bytes);
write("public/logo.png", tile[256]);
write("public/logo-256.png", tile[256]);
write("public/logo-master.png", tile[512]);
write("public/favicon.png", tile[128]);
write("public/favicon-32.png", tile[32]);
write("docs/logo/logo.png", tile[512]);
write("docs/favicon.png", tile[128]);

const imagesPath = path.join(ROOT, "src/assets/images.ts");
let images = fs.readFileSync(imagesPath, "utf8");
const embed = (name, bytes) => {
  const re = new RegExp(`export const ${name} = "[^"]*";`);
  if (!re.test(images)) throw new Error(`${name} not found in src/assets/images.ts`);
  images = images.replace(re, `export const ${name} = "${bytes.toString("base64")}";`);
};
embed("LOGO_PNG_BASE64", tile[256]);
embed("FAVICON_PNG_BASE64", tile[128]);
embed("FAVICON_32_PNG_BASE64", tile[32]);
embed("OG_PNG_BASE64", og);
fs.writeFileSync(imagesPath, images);
console.log("brand assets written");
