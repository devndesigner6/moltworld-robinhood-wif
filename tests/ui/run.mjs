// UI tests for every Moltworld page across desktop, tablet and phone viewports.
// Boots the offline local stack (mock chain + reference facilitator + seeded traffic),
// then drives the real page with Playwright.
//
//   pnpm test:ui                     # all viewports, light + dark
//   UI_SHOTS=/path pnpm test:ui      # where screenshots go (default ./ui-artifacts)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SHOTS = process.env.UI_SHOTS ?? path.join(ROOT, "ui-artifacts");
const PORT = Number(process.env.UI_PORT ?? 3499);
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: "desktop-1440", options: { viewport: { width: 1440, height: 900 } }, mobile: false },
  { name: "laptop-1024", options: { viewport: { width: 1024, height: 768 } }, mobile: false },
  { name: "tablet-ipad-mini", options: devices["iPad Mini"], mobile: true },
  { name: "phone-iphone-13", options: devices["iPhone 13"], mobile: true },
  { name: "phone-pixel-7", options: devices["Pixel 7"], mobile: true },
  { name: "phone-small-320", options: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, mobile: true },
];

const results = [];
let current = "";
function check(name, condition, detail = "") {
  results.push({ viewport: current, name, ok: !!condition, detail: condition ? "" : String(detail) });
  if (!condition) console.error(`  ✗ [${current}] ${name} ${detail}`);
}

async function startStack() {
  const child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/local-stack.ts"], {
    cwd: ROOT,
    // Twelve browser sessions from one IP would trip the production rate limit.
    env: { ...process.env, PORT: String(PORT), PUBLIC_DOMAIN: BASE, RATE_LIMIT_MAX: "100000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stack did not start:\n${log.slice(-2000)}`)), 90_000);
    const onData = (d) => {
      log += d;
      if (log.includes("LOCAL STACK READY")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`stack exited ${code}:\n${log.slice(-2000)}`)));
  });
  return child;
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest("pre, .table-wrap, .skip, .sr-only, [data-clip], .rail")) continue;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1)) offenders.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
    }
    return { scroll: document.documentElement.scrollWidth - vw, offenders: offenders.slice(0, 5) };
  });
}

// Every HTML page reachable from the home page through internal links.
async function crawlSite() {
  const skip = /^\/(v1|\.well-known|assets|llms\.txt|health|mcp|a2a)|\.(png|ico|json|txt|svg)$/;
  const seen = new Set(["/"]);
  const queue = ["/"];
  const broken = [];
  while (queue.length) {
    const p = queue.shift();
    const res = await fetch(BASE + p);
    if (res.status !== 200) {
      broken.push(`${p} -> ${res.status}`);
      continue;
    }
    const html = await res.text();
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
      if (!skip.test(href) && !seen.has(href)) {
        seen.add(href);
        queue.push(href);
      }
    }
  }
  return { pages: [...seen].sort(), broken };
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Browsers log every non-2xx fetch as "Failed to load resource"; statuses are checked below instead.
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`console: ${m.text()}`));
  const EXPECTED = [
    [402, /\/v1\/models\/[^/]+\/chat\/completions$/], // "Show 402 challenge"
    [400, /\/v1\/quote$/], // the deliberate invalid-input check
    [404, /\/v1\/mandates\/[A-Z2-7]{58}$/], // looking up an unknown mandate id
  ];
  page.on("response", (r) => {
    if (r.status() < 400 || !r.url().startsWith(BASE)) return;
    const pathname = new URL(r.url()).pathname;
    if (!EXPECTED.some(([status, re]) => status === r.status() && re.test(pathname))) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${current.replace("/", "-")}-${name}.png`), ...opts });

async function checkPage(page, p, vp, scheme) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  const overflow = await noHorizontalOverflow(page);
  check(`${p}: no horizontal page scroll`, overflow.scroll <= 0, `scrollWidth exceeds viewport by ${overflow.scroll}px`);
  check(`${p}: no element extends past the viewport`, overflow.offenders.length === 0, overflow.offenders.join(", "));
  check(`${p}: single h1`, (await page.locator("h1").count()) === 1);
  check(`${p}: has a title`, (await page.title()).includes("Moltworld"), await page.title());
  check(`${p}: html has lang`, (await page.getAttribute("html", "lang")) === "en");
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((el) => !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute("aria-label"))
      .map((el) => el.id || el.name)
  );
  check(`${p}: every form control has a label`, unlabeled.length === 0, unlabeled.join(","));
  check(`${p}: images have alt text`, (await page.locator("img:not([alt])").count()) === 0);
  check(`${p}: no in-page links in the header`, (await page.locator('header a[href^="#"]').count()) === 0);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(`${p}: ${scheme} color scheme applied`, scheme === "dark" ? bg === "rgb(10, 10, 11)" : bg === "rgb(244, 243, 238)", bg);
  if (vp.mobile) {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, .btn, nav a")]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => el.getBoundingClientRect().height < 36)
        .map((el) => el.textContent.trim().slice(0, 20))
    );
    check(`${p}: tap targets at least 36px tall`, small.length === 0, small.join(" | "));
  }
}

async function runViewport(browser, vp, scheme, pages) {
  current = `${vp.name}/${scheme}`;
  console.log(`▶ ${current}`);
  const context = await browser.newContext({ ...vp.options, colorScheme: scheme });
  const page = await context.newPage();
  const errors = watchErrors(page);

  // Every page
  for (const p of pages) await checkPage(page, p, vp, scheme);

  // Header
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const label = (await page.textContent("#netLabel")).trim();
  check("header shows the network from /health", /^Algorand (Mainnet|Testnet)$/.test(label), label);
  const triggers = (await page.locator(".nav-trigger").allTextContents()).map((t) => t.trim());
  check("header menus", triggers.join(",") === "Product,Solutions,Use cases,Developers", triggers.join(","));
  const direct = (await page.locator(".nav-direct").allTextContents()).map((t) => t.trim());
  check("header links", direct.join(",") === "Models,Pricing,Stats", direct.join(","));
  check("header links to GitHub", await page.locator('.header-actions a[href="https://github.com/hackcat29/moltworld-x402"]').isVisible());
  const collapsed = await page.locator("#menuBtn").isVisible();
  if (collapsed) {
    check("mobile: nav hidden until the menu button is used", !(await page.locator("#nav").isVisible()));
    await page.click("#menuBtn");
    check("mobile: menu button opens the nav", (await page.getAttribute("#menuBtn", "aria-expanded")) === "true" && (await page.locator("#nav").isVisible()));
    check("mobile: page behind the menu does not scroll", (await page.evaluate(() => getComputedStyle(document.body).overflow)) === "hidden");
    check("mobile: Playground in the open menu", await page.locator('.nav-mobile-cta a[href="/playground"]').isVisible());
    await page.click('.nav-trigger[aria-controls="menu-solutions"]');
    check("mobile: section expands", await page.locator("#menu-solutions").isVisible());
    await shot(page, "menu-open");
    await page.click('#menu-solutions a[href="/solutions/model-escalation"]');
    await page.waitForURL(BASE + "/solutions/model-escalation");
    check("mobile: menu link navigates", (await page.textContent("h1")).length > 0);
    check("mobile: menu closed after navigation", !(await page.locator("#nav").isVisible()));
    await page.click("#menuBtn");
    await page.click("#menuBtn");
    check("mobile: menu button closes the nav", !(await page.locator("#nav").isVisible()) && (await page.evaluate(() => getComputedStyle(document.body).overflow)) !== "hidden");
  } else {
    const cta = page.locator('.header-actions a[href="/playground"]');
    check("desktop: Playground button in the header", await cta.isVisible());
    await page.click('.nav-trigger[aria-controls="menu-products"]');
    check("desktop: dropdown opens on click", (await page.locator("#menu-products").isVisible()) && (await page.getAttribute('.nav-trigger[aria-controls="menu-products"]', "aria-expanded")) === "true");
    const menuBox = await page.locator("#menu-products").boundingBox();
    const vw = page.viewportSize().width;
    check("desktop: dropdown fits the viewport", menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= vw, JSON.stringify(menuBox));
    await shot(page, "dropdown");
    await page.keyboard.press("Escape");
    check("desktop: Escape closes the dropdown", !(await page.locator("#menu-products").isVisible()));
    await page.click('.nav-trigger[aria-controls="menu-solutions"]');
    await page.mouse.click(5, page.viewportSize().height - 5);
    check("desktop: outside click closes the dropdown", !(await page.locator("#menu-solutions").isVisible()));
    await page.click('.nav-trigger[aria-controls="menu-products"]');
    await page.click('#menu-products a[href="/products/mandates"]');
    await page.waitForURL(BASE + "/products/mandates");
    check("desktop: dropdown link navigates", true);
    check("desktop: current section marked", (await page.locator(".nav-item.active .nav-trigger").textContent()).trim() === "Product");
    const buildLinks = await page.locator("#menu-developers .nav-col").first().locator("a").evaluateAll((els) => els.map((a) => a.href));
    check("desktop: developer menu points at the docs site", buildLinks.length > 0 && buildLinks.every((h) => h.startsWith("https://docs.moltworld.xyz")), buildLinks.join(","));
    await page.click('.nav-trigger[aria-controls="menu-developers"]');
    const devBox = await page.locator("#menu-developers").boundingBox();
    check("desktop: developer menu fits the viewport", devBox && devBox.x >= 0 && devBox.x + devBox.width <= vw, JSON.stringify(devBox));
    await page.keyboard.press("Escape");
    await page.click('.header-actions a[href="/playground"]');
    await page.waitForURL(BASE + "/playground");
    check("desktop: Playground button navigates", true);
  }

  // Home: code tabs with keyboard
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("sPaid")?.textContent !== "-");
  await shot(page, "home-full", { fullPage: true });
  await page.locator("#t-hero-ts").focus();
  await page.keyboard.press("ArrowRight");
  check("arrow key switches code tab", (await page.getAttribute("#t-hero-py", "aria-selected")) === "true" && (await page.locator("#p-hero-py").isVisible()));
  check("previous panel hidden", !(await page.locator("#p-hero-ts").isVisible()));

  // Playground: quote, 402 challenge, snippets
  await page.goto(BASE + "/playground", { waitUntil: "networkidle" });
  await page.selectOption("#qModel", "gpt-4o");
  await page.fill("#qMessage", "Explain atomic transfers on Algorand.");
  await page.fill("#qMaxTokens", "500");
  await page.click("#quoteBtn");
  await page.waitForSelector("#quoteOut .big-price");
  const shown = (await page.textContent("#quoteOut .big-price")).trim();
  const expected = await page.evaluate(async () => {
    const r = await fetch("/v1/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Explain atomic transfers on Algorand." }], max_tokens: 500 }),
    });
    return (await r.json()).quote.formattedPrice;
  });
  check("chat quote matches /v1/quote", shown === expected, `${shown} vs ${expected}`);
  check("curl snippet follows the form", (await page.textContent("#snipCurl")).includes("/v1/models/gpt-4o/chat/completions"));
  check("snippet carries the body", (await page.textContent("#snipCurl")).includes("Explain atomic transfers on Algorand."));

  await page.click("#challengeBtn");
  await page.waitForFunction(() => document.querySelector("#quoteOut .note")?.textContent.includes("402"));
  const challengePrice = (await page.textContent("#quoteOut .big-price")).trim();
  check("402 challenge amount equals the quote", challengePrice === expected, `${challengePrice} vs ${expected}`);
  check("402 challenge shows payTo", (await page.textContent("#quoteOut")).includes("Pay to"));

  await page.selectOption("#qModel", "gpt-image-1.5");
  check("image fields shown", await page.locator('[data-for="image"]').isVisible());
  check("chat fields hidden for image model", !(await page.locator('[data-for="chat"]').isVisible()));
  await page.click("#quoteBtn");
  await page.waitForFunction(() => document.querySelector("#quoteOut")?.textContent.includes("images"));
  check("snippet follows the image model", (await page.textContent("#snipCurl")).includes("/images/generations"));

  await page.selectOption("#qModel", "gpt");
  await page.fill("#qMaxTokens", "999999");
  await page.click("#quoteBtn");
  await page.waitForSelector("#quoteOut .err");
  check("invalid input shows an error", (await page.textContent("#quoteOut .err")).includes("max_tokens"));
  await page.fill("#qMaxTokens", "300");

  // Playground: receipts verified in the browser with WebCrypto Ed25519
  const requestId = await page.evaluate(async () => (await (await fetch("/v1/stats")).json()).recent_settlements[0].request_id);
  await page.fill("#receiptInput", requestId);
  await page.click('#receiptForm button[type="submit"]');
  await page.waitForSelector("#receiptOut .badge");
  check("receipt lookup verifies as valid", (await page.textContent("#receiptOut .badge")).trim() === "Valid", await page.textContent("#receiptOut"));
  check("receipt verified in the browser", (await page.textContent("#receiptOut")).includes("checked in your browser"));
  const tampered = await page.evaluate(async (id) => {
    const r = (await (await fetch("/v1/receipts/" + id)).json()).receipt;
    return JSON.stringify({ ...r, amountMicro: r.amountMicro + 1 });
  }, requestId);
  await page.fill("#receiptInput", tampered);
  await page.click('#receiptForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("#receiptOut .badge")?.textContent.trim() === "Invalid");
  check("tampered receipt is rejected", true);

  // Playground: real x402 payments on the local ledger, from a wallet and from an agent mandate
  await page.click("#walletLoad");
  await page.locator("[data-wallet]", { hasText: "Local dev wallet" }).click();
  await page.waitForFunction(() => /USDC$/.test(document.getElementById("walletBal")?.textContent || ""));
  const balanceOf = async () => parseFloat((await page.textContent("#walletBal")).replace(/[^0-9.]/g, ""));
  const before = await balanceOf();
  await page.selectOption("#qModel", "gpt-4o");
  await page.fill("#qMessage", "Paid run from the UI test.");
  const runQuote = await page.evaluate(async () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: document.getElementById("qMessage").value }], max_tokens: Number(document.getElementById("qMaxTokens").value) };
    return (await (await fetch("/v1/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()).quote.formattedPrice;
  });
  const priced = await page.waitForFunction((want) => document.getElementById("runPrice").textContent === want, runQuote, { timeout: 5000 }).then(() => true, () => false);
  check("run button shows the live price", priced, `${await page.textContent("#runPrice")} vs ${runQuote}`);
  await page.click("#runBtn");
  await page.waitForSelector("#quoteOut .run-receipt", { timeout: 30000 });
  check("wallet run returns the model's answer", (await page.textContent("#quoteOut .answer-text")).includes("Paid run from the UI test."));
  check("wallet run receipt verifies in the browser", (await page.textContent("#quoteOut .run-receipt .badge")).trim() === "Receipt valid", await page.textContent("#quoteOut"));
  const settlement = await page.getAttribute("#quoteOut .run-receipt a", "href");
  check("wallet run links its settlement", settlement?.startsWith("https://lora.algokit.io/testnet/transaction/"), settlement);
  await page.waitForFunction((b) => parseFloat(document.getElementById("walletBal").textContent.replace(/[^0-9.]/g, "")) < b, before);
  check("wallet balance drops after paying", (await balanceOf()) < before);

  await page.click('[data-payer-mode="mandate"]');
  await page.click("#mandateDev");
  await page.waitForSelector("#mandateActive:not(.hidden)");
  const owner = await page.getAttribute("#mandateOwner", "title");
  check("dev mandate's cap is enforced on-chain", (await page.textContent("#mandateLimits")).includes("cap on-chain"), await page.textContent("#mandateLimits"));
  await page.fill("#capInput", "0.0001");
  await page.click("#runBtn");
  await page.waitForSelector("#quoteOut .err");
  check("per-request cap blocks the payment", (await page.textContent("#quoteOut .err")).includes("max per request"));
  await page.fill("#capInput", "1");
  await page.selectOption("#qModel", "gpt");
  await page.click("#runBtn");
  await page.waitForSelector("#quoteOut .run-receipt", { timeout: 30000 });
  check("mandate run receipt verifies", (await page.textContent("#quoteOut .run-receipt .badge")).trim() === "Receipt valid");
  check("mandate run is paid by the mandate owner", (await page.textContent("#quoteOut .run-receipt")).includes(owner), owner);
  await page.waitForFunction(() => !document.getElementById("mandateLimits").textContent.includes("$0 of"));
  check("mandate spend updates after paying", true);
  check("this browser shows its own agent address", /^Agent [A-Z2-7]{6}\.\.\./.test(await page.textContent("#agentAddr")), await page.textContent("#agentAddr"));
  const devCredential = await page.evaluate(() => JSON.parse(document.getElementById("payConfig").textContent).devMandate);
  await page.click("#mandateOff");
  await page.fill("#mandateCred", devCredential);
  await page.click("#mandateUse");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("bound to agent"));
  check("a credential bound to another agent is refused", await page.locator("#mandateActive.hidden").count() === 1);
  await shot(page, "playground", { fullPage: true });

  // Models: catalog filters, paging, search, link to the playground
  await page.goto(BASE + "/models", { waitUntil: "networkidle" });
  check("removed video category is not offered", await page.locator('[data-filter="video"]').count() === 0);
  await page.click('[data-filter="image"]');
  check("image filter shows the retained image model", await page.locator('#modelList .model:not(.hidden)').count() === 1);
  await page.click('[data-filter="all"]');
  check("catalog paginates", (await page.locator("#modelList .model:not(.hidden)").count()) === 12);
  await page.click("#moreBtn");
  check("show more reveals more models", (await page.locator("#modelList .model:not(.hidden)").count()) > 12);
  await page.fill("#search", "claude");
  const names = await page.locator("#modelList .model:not(.hidden) h3").allTextContents();
  check("search filters by name", names.length > 0 && names.every((n) => n.toLowerCase().includes("claude")), names.join(","));
  await page.fill("#search", "zzz-no-such-model");
  check("empty search shows a message", await page.locator("#noModels").isVisible());
  await page.fill("#search", "gpt-image");
  await page.locator('#modelList .model:not(.hidden) a[href="/playground?model=gpt-image-1.5"]').click();
  await page.waitForURL(BASE + "/playground?model=gpt-image-1.5");
  check("'Try in Playground' preselects the model", (await page.inputValue("#qModel")) === "gpt-image-1.5");

  // Mandate lookup
  await page.goto(BASE + "/products/mandates", { waitUntil: "networkidle" });
  await page.fill("#mandateQuery", "not-an-address");
  await page.click('#mandateForm button[type="submit"]');
  await page.waitForSelector("#mandateOut .err");
  check("mandate lookup validates input", true);
  await page.fill("#mandateQuery", "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU");
  await page.click('#mandateForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById("mandateOut").textContent.includes("No mandates"));
  check("mandate lookup handles unknown ids", true);

  // Marketplace
  await page.goto(BASE + "/products/marketplace", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("marketOut").textContent.includes("Weather Now"));
  check("live marketplace listings render", true);
  await page.fill("#earnAddr", "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU");
  await page.click('#earnForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById("earnOut").textContent.includes("Unpaid"));
  check("creator earnings lookup works", true);

  // Usage
  await page.goto(BASE + "/stats", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("sPaid")?.textContent !== "-");
  const rows = await page.locator("#recentRows tr").count();
  check("recent settlements listed", rows >= 5, `${rows} rows`);
  const href = await page.locator("#recentRows a").first().getAttribute("href");
  check("settlements link to the explorer", href?.startsWith("https://lora.algokit.io/testnet/transaction/"), href);
  check("success rate comes from the facilitator", (await page.textContent("#sSuccessRate")) === "99.77%", await page.textContent("#sSuccessRate"));
  check("network mix lists every network", (await page.locator("#networkRows tr").count()) === 2);
  check("every facilitator endpoint is listed", (await page.locator("#topModelRows tr").count()) === 5, `${await page.locator("#topModelRows tr").count()} rows`);
  await page.click('#endpointFilters button:has-text("Chat")');
  check("endpoint filter narrows the table", (await page.locator("#topModelRows tr").count()) === 1);
  await page.click('#endpointFilters button:has-text("All")');
  check("listing shows Bazaar and both accounts", (await page.textContent("#listingList")).includes("Listed") && (await page.locator("#listingList dt").count()) === 5);

  // Pages with config tabs
  await page.goto(BASE + "/solutions/agents", { waitUntil: "networkidle" });
  await page.click("#t-agents-openclaw");
  check("agent config tabs switch", await page.locator("#p-agents-openclaw").isVisible());
  await shot(page, "solutions-agents", { fullPage: true });
  await page.goto(BASE + "/use-cases/coding-agents", { waitUntil: "networkidle" });
  check("agent use case shows how it connects", (await page.locator(".pays").count()) > 0);
  await page.click("#t-agent-cursor");
  check("agent config tabs switch", await page.locator("#p-agent-cursor").isVisible());
  await shot(page, "use-case", { fullPage: true });
  const moved = await page.goto(BASE + "/use-cases/agent-allowance", { waitUntil: "networkidle" });
  check("old workflow URLs redirect to /solutions", moved.url() === BASE + "/solutions/agent-allowance", moved.url());

  const after = await noHorizontalOverflow(page);
  check("no horizontal scroll after interactions", after.scroll <= 0 && after.offenders.length === 0, `${after.scroll} ${after.offenders}`);
  check("no console errors or failed requests", errors.length === 0, errors.join(" | "));
  await context.close();
}

fs.mkdirSync(SHOTS, { recursive: true });
const selectedViewports = VIEWPORTS.filter(v => !process.env.UI_VIEWPORT || v.name === process.env.UI_VIEWPORT);
if (!selectedViewports.length) throw new Error("Unknown UI_VIEWPORT");
const stack = await startStack();
const browser = await chromium.launch();
try {
  current = "site";
  const { pages, broken } = await crawlSite();
  console.log(`${pages.length} pages: ${pages.join(" ")}`);
  check("internal links all resolve", broken.length === 0, broken.join(", "));
  check("every section has pages", ["/products", "/solutions", "/use-cases", "/playground", "/models", "/stats", "/pricing", "/developers", "/use-cases/coding-agents", "/solutions/agent-allowance"].every((p) => pages.includes(p)), pages.join(","));
  for (const vp of selectedViewports) {
    for (const scheme of ["light", "dark"]) {
      try {
        await runViewport(browser, vp, scheme, pages);
      } catch (err) {
        check("viewport run completed", false, err.message.split("\n")[0]);
      }
    }
  }
} finally {
  await browser.close();
  stack.kill();
}

const failed = results.filter((r) => !r.ok);
const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, viewports: selectedViewports.length * 2, screenshots: SHOTS };
fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
process.exit(failed.length ? 1 : 0);
