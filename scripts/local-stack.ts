/**
 * Runs the whole gateway offline for development, demos and UI tests:
 * a simulated Algorand ledger, a facilitator running the reference @x402/avm
 * logic, mock upstream models, and some seeded paid traffic.
 *
 *   pnpm stack:local            # http://127.0.0.1:3402
 *   PORT=4000 pnpm stack:local
 */
import algosdk from "algosdk";
import { serve } from "@hono/node-server";
import { createPayer, startHarness } from "../tests/helpers/harness.js";

process.env.NODE_ENV ??= "development";
// The simulated facilitator only serves testnet; ignore a developer's mainnet .env.
process.env.ALGORAND_NETWORK = "testnet";
process.env.MOCK_PROVIDERS = "true";
process.env.SKIP_UPSTREAM_VERIFICATION = "true";
process.env.BACKGROUND_WORKERS = "true";
process.env.ADMIN_TOKEN ??= "local-admin";

const port = Number(process.env.PORT ?? 3402);
const harness = await startHarness();
process.env.FACILITATOR_URL = harness.facilitatorUrl;
process.env.ALGOD_URL = harness.algodUrl;
process.env.PUBLIC_ALGOD_URL = harness.algodUrl;
// Mandates are capped on-chain by a spend counter the simulated ledger models.
process.env.MANDATE_COUNTER_APP_ID ??= "4242";
process.env.PUBLIC_DOMAIN ??= `http://127.0.0.1:${port}`;

// A funded wallet on the simulated ledger, offered in the Playground as "Local dev wallet".
const devWallet = algosdk.generateAccount();
harness.chain.balances.set(devWallet.addr.toString(), 25_000_000);
process.env.PLAYGROUND_DEV_WALLET_KEY = Buffer.from(devWallet.sk).toString("base64");

const { app, init } = await import("../src/app.js");
const { startBackgroundWorkers } = await import("../src/workers/index.js");
const { signOwnerMessage } = await import("../src/mandates/index.js");
const { setCreatorFetcherForTests } = await import("../src/routes/market.js");
const { config } = await import("../src/config.js");
const { createMandate, generateAgentKey } = await import("../sdk/js/src/index.js");
harness.chain.counter = {
  appId: Number(process.env.MANDATE_COUNTER_APP_ID),
  payTo: config.payToAddress,
  assetId: Number(config.usdcAsaId),
  minAmountMicro: Math.round(config.priceMinFloor * 1_000_000),
  boxes: new Map(),
};
await init();
startBackgroundWorkers();

const appFetch = (req: Request) => app.fetch(req) as Promise<Response>;

async function seed() {
  const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (let i = 0; i < 3; i++) {
    const payer = createPayer(harness, appFetch);
    await payer.fetch(`http://127.0.0.1/v1/models/gpt-4o/chat/completions`, json({ messages: [{ role: "user", content: `Hello #${i}` }], max_tokens: 400 }));
    await payer.fetch(`http://127.0.0.1/v1/models/claude-sonnet-5/chat/completions`, json({ messages: [{ role: "user", content: "Summarize x402" }], max_tokens: 300 }));
    if (i === 0) await payer.fetch(`http://127.0.0.1/v1/models/gpt-image-1.5/images/generations`, json({ prompt: "A lighthouse at dawn" }));
  }

  // One approved marketplace listing, served by a local stand-in for the creator API.
  setCreatorFetcherForTests(async (_url, init) => {
    const input = JSON.parse(new TextDecoder().decode(init.body) || "{}");
    return { status: 200, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify({ city: input.city ?? "Lagos", tempC: 31, source: "demo" })) };
  });
  const creator = algosdk.generateAccount();
  const listing = {
    action: "list",
    creator: creator.addr.toString(),
    slug: "weather-now",
    name: "Weather Now",
    description: "Current temperature for a city, as JSON. Demo listing.",
    upstream_url: "https://weather.example.com/now",
    price_usd: 0.002,
    input_example: { city: "Lagos" },
    issued_at: Math.floor(Date.now() / 1000),
  };
  await appFetch(new Request("http://127.0.0.1/v1/market/listings", json({ listing, creator_sig: signOwnerMessage(listing, creator.sk) })));
  const pending = await (await appFetch(new Request("http://127.0.0.1/v1/ops/listings?status=pending", { headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } }))).json();
  for (const l of pending.data) {
    await appFetch(
      new Request(`http://127.0.0.1/v1/ops/listings/${l.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
        body: JSON.stringify({ status: "approved" }),
      })
    );
  }
  const buyer = createPayer(harness, appFetch);
  await buyer.fetch("http://127.0.0.1/v1/market/weather-now/call", json({ city: "Accra" }));

  // A registered mandate over a funded owner, bound to a dev agent key, offered in the Playground's
  // mandate mode. It goes through the same draft, verify, delegate and register steps as createMandate.
  const owner = algosdk.generateAccount();
  const agent = generateAgentKey();
  harness.chain.balances.set(owner.addr.toString(), 5_000_000);
  const sdkFetch = ((input: RequestInfo | URL, init?: RequestInit) => appFetch(new Request(input as any, init))) as typeof fetch;
  const { credential } = await createMandate("http://127.0.0.1", owner, { agent: agent.address, maxPerCallUsd: 0.5, dailyCapUsd: 2, validDays: 7, label: "Local dev mandate", algodUrl: harness.algodUrl }, sdkFetch);
  config.playgroundDev.mandate = Buffer.from(JSON.stringify(credential)).toString("base64");
  config.playgroundDev.agentKey = agent.secretKeyB64;
}

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, async () => {
  if (process.env.SEED !== "false") await seed();
  console.log(`LOCAL STACK READY http://127.0.0.1:${port}`);
});
