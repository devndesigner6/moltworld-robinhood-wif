import { afterAll, beforeAll, describe, expect, it } from "vitest";
import algosdk from "algosdk";
import { Harness, startHarness } from "./helpers/harness.js";
import {
  CappedMandateScheme,
  MoltworldClient,
  MoltworldError,
  assembleCounter as sdkAssembleCounter,
  assembleMandate as sdkAssemble,
  createMandate,
  generateAgentKey,
  revokeMandate,
  verifyCounterApp,
  verifyDraft,
} from "../sdk/js/src/index.js";

// This file runs the gateway with the on-chain spend counter enabled (modeled by the harness).
const COUNTER_APP_ID = 4242;

let harness: Harness;
let app: any;
let gatewayFetch: typeof fetch;

beforeAll(async () => {
  harness = await startHarness();
  process.env.FACILITATOR_URL = harness.facilitatorUrl;
  process.env.ALGOD_URL = harness.algodUrl;
  process.env.MANDATE_COUNTER_APP_ID = String(COUNTER_APP_ID);
  const mod = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  harness.chain.counter = {
    appId: COUNTER_APP_ID,
    payTo: config.payToAddress,
    assetId: Number(config.usdcAsaId),
    minAmountMicro: Math.round(config.priceMinFloor * 1_000_000),
    boxes: new Map(),
  };
  app = mod.app;
  await mod.init();
  gatewayFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input as any, init))) as typeof fetch;
});
afterAll(() => harness.close());

function fundedClient(options: Partial<ConstructorParameters<typeof MoltworldClient>[0]> = {}) {
  const account = algosdk.generateAccount();
  harness.chain.balances.set(account.addr.toString(), 5_000_000);
  return new MoltworldClient({
    baseUrl: "http://localhost",
    privateKeyBase64: Buffer.from(account.sk).toString("base64"),
    algodUrl: harness.algodUrl,
    fetch: gatewayFetch,
    ...options,
  });
}

describe("JS SDK", () => {
  it("pays, and verifies the receipt against the request and response bytes", async () => {
    const client = fundedClient();
    const quote = await client.quote("gpt-4o", { messages: [{ role: "user", content: "hello" }], max_tokens: 500 });
    const result = await client.chat("gpt-4o", { messages: [{ role: "user", content: "hello" }], max_tokens: 500 });
    expect(result.verification?.ok).toBe(true);
    expect(result.verification?.requestMatches).toBe(true);
    expect(result.verification?.responseMatches).toBe(true);
    expect(result.paidMicro).toBe(quote.microUsdc);
    expect(result.receipt?.payer).toBe(client.address);
    expect(client.spentUsd).toBeCloseTo(quote.microUsdc / 1e6, 6);
  });

  it("enforces the per-request cap and session budget before signing", async () => {
    const capped = fundedClient({ maxPerRequestUsd: 0.001 });
    await expect(capped.chat("gpt-4o", { messages: [{ role: "user", content: "x" }], max_tokens: 2000 })).rejects.toThrow(/maxAmountPerPayment|rejected/i);

    const budgeted = fundedClient({ budgetUsd: 0.002 });
    await budgeted.chat("gpt", { messages: [{ role: "user", content: "x" }], max_tokens: 50 });
    await budgeted.chat("gpt", { messages: [{ role: "user", content: "x" }], max_tokens: 50 });
    await expect(budgeted.chat("gpt", { messages: [{ role: "user", content: "x" }], max_tokens: 50 })).rejects.toThrow(/Budget/);
    expect(budgeted.spentUsd).toBeLessThanOrEqual(0.002);
  });

  it("refuses to pay an unexpected address", async () => {
    const client = fundedClient({ expectedPayTo: algosdk.generateAccount().addr.toString() });
    await expect(client.chat("gpt", { messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/Refusing to pay/);
  });

  it("surfaces gateway errors with codes", async () => {
    const client = fundedClient();
    const err = await client.chat("gpt", { messages: [] as any }).catch((e) => e);
    expect(err).toBeInstanceOf(MoltworldError);
    expect(err.status).toBe(400);
  });

  it("creates a mandate, lets an agent pay under it, and revokes it", async () => {
    const owner = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 5_000_000);
    const agentKey = generateAgentKey();
    const { mandateId, credential } = await createMandate("http://localhost", owner, { agent: agentKey.address, maxPerCallUsd: 0.25, dailyCapUsd: 1, algodUrl: harness.algodUrl }, gatewayFetch);
    // The credential alone is not enough to pay: the agent's own key is required.
    expect(() => new MoltworldClient({ baseUrl: "http://localhost", mandate: credential, fetch: gatewayFetch })).toThrow(/agent/);
    expect(() => new MoltworldClient({ baseUrl: "http://localhost", mandate: credential, agentKey: generateAgentKey().secretKeyB64, fetch: gatewayFetch })).toThrow(/not the key/);
    const agent = new MoltworldClient({ baseUrl: "http://localhost", mandate: credential, agentKey: agentKey.secretKeyB64, algodUrl: harness.algodUrl, fetch: gatewayFetch });
    const result = await agent.chat("gpt", { messages: [{ role: "user", content: "paid by mandate" }] });
    expect(result.receipt?.payer).toBe(owner.addr.toString());
    expect(harness.chain.settled.at(-1)!.lsig).toBe(true);
    // The payment went through the on-chain spend counter, which recorded it.
    expect([...harness.chain.counter!.boxes.values()].some((b) => b.spent === result.paidMicro)).toBe(true);
    const view = await (await gatewayFetch(`http://localhost/v1/mandates/${mandateId}`)).json();
    expect(view.mandate.on_chain_cap).toMatchObject({ app_id: COUNTER_APP_ID, window_rounds: 30_000 });

    await revokeMandate("http://localhost", owner, mandateId, gatewayFetch);
    await expect(agent.chat("gpt", { messages: [{ role: "user", content: "after revoke" }] })).rejects.toThrow(/mandate/i);
  });

  it("caps spending on-chain: the counter refuses payments past the cap, with no help from the gateway", async () => {
    const owner = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 5_000_000);
    const agentKey = generateAgentKey();
    const { credential } = await createMandate("http://localhost", owner, { agent: agentKey.address, maxPerCallUsd: 0.4, dailyCapUsd: 1, algodUrl: harness.algodUrl }, gatewayFetch);
    const scheme = new CappedMandateScheme(credential, agentKey.secretKeyB64, harness.algodUrl);
    const health = await (await gatewayFetch("http://localhost/health")).json();
    const supported = await (await fetch(`${harness.facilitatorUrl}/supported`)).json();
    const network = supported.kinds[0].network;
    const requirements = (amount: number) => ({
      scheme: "exact", network, amount: String(amount), asset: String(health.usdc_asset_id), payTo: health.pay_to,
      maxTimeoutSeconds: 60, extra: { feePayer: harness.feePayerAddress },
    });
    // Straight to the facilitator: only Algorand-side rules (program + counter) apply here.
    const settle = async (amount: number) => {
      const paymentRequirements = requirements(amount);
      const paymentPayload = { ...(await scheme.createPaymentPayload(2, paymentRequirements)), accepted: paymentRequirements, resource: { url: "http://localhost/x" } };
      return (await fetch(`${harness.facilitatorUrl}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentPayload, paymentRequirements }) })).json();
    };
    expect((await settle(400_000)).success).toBe(true);
    expect((await settle(400_000)).success).toBe(true);
    const third = await settle(400_000); // 1.2 USDC in the window: over the 1.0 cap
    expect(third.success).toBe(false);
    expect(JSON.stringify(third)).toMatch(/cap/);
    expect((await settle(200_000)).success).toBe(true); // exactly at the cap
  });

  it("refuses to sign when the counter app is not the audited code", async () => {
    const health = await (await gatewayFetch("http://localhost/health")).json();
    const terms = { payTo: health.pay_to, assetId: Number(health.usdc_asset_id), minAmountMicro: health.mandate_counter.min_amount_micro };
    await expect(verifyCounterApp(harness.algodUrl, COUNTER_APP_ID, terms)).resolves.toBeUndefined();
    await expect(verifyCounterApp(harness.algodUrl, COUNTER_APP_ID, { ...terms, minAmountMicro: 1 })).rejects.toThrow(/Do not sign/);
    await expect(verifyCounterApp(harness.algodUrl, 999, terms)).rejects.toThrow(/not found/);
  });

  it("refuses to sign a draft whose program differs from what was asked", async () => {
    const agentAddr = generateAgentKey().address;
    const draftRes = await gatewayFetch("http://localhost/v1/mandates/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: algosdk.generateAccount().addr.toString(), agent: agentAddr, max_per_call_usd: 0.5, daily_cap_usd: 1 }),
    });
    const draft = await draftRes.json();
    const health = await (await gatewayFetch("http://localhost/health")).json();
    const expected = { payTo: health.pay_to, assetId: Number(health.usdc_asset_id), maxPerCallMicro: 500_000, agent: agentAddr, counter: { appId: COUNTER_APP_ID, capMicro: 1_000_000 } };
    expect(() => verifyDraft(draft, expected)).not.toThrow();
    expect(() => verifyDraft(draft, { ...expected, maxPerCallMicro: 100_000 })).toThrow(/Do not sign/);
    const evil = algosdk.generateAccount().addr.toString();
    expect(() => verifyDraft(draft, { ...expected, payTo: evil })).toThrow();
    // A draft bound to someone else's agent key, or with a different cap or counter, is refused too.
    expect(() => verifyDraft(draft, { ...expected, agent: evil })).toThrow(/Do not sign/);
    expect(() => verifyDraft(draft, { ...expected, counter: { appId: COUNTER_APP_ID, capMicro: 2_000_000 } })).toThrow(/Do not sign/);
    expect(() => verifyDraft(draft, { ...expected, counter: { appId: 1, capMicro: 1_000_000 } })).toThrow(/Do not sign/);
  });

  it("assembles mandates byte-identically to the gateway", async () => {
    const { assembleMandate } = await import("../src/mandates/index.js");
    const t = { payTo: algosdk.generateAccount().addr.toString(), assetId: 31566704, maxPerCallMicro: 123456, expiryRound: 99999999, salt: new Uint8Array(16).fill(9) };
    expect(Buffer.from(sdkAssemble(t)).equals(Buffer.from(assembleMandate(t)))).toBe(true);
    const bound = { ...t, agent: algosdk.generateAccount().addr.toString() };
    expect(Buffer.from(sdkAssemble(bound)).equals(Buffer.from(assembleMandate(bound)))).toBe(true);
    const capped = { ...bound, counter: { appId: 775006909, capMicro: 5_000_000, windowRounds: 30_000 } };
    expect(Buffer.from(sdkAssemble(capped)).equals(Buffer.from(assembleMandate(capped)))).toBe(true);
    const { assembleCounter } = await import("../src/mandates/counter.js");
    const ct = { payTo: t.payTo, assetId: 31566704, minAmountMicro: 1000 };
    expect(Buffer.from(sdkAssembleCounter(ct)).equals(Buffer.from(assembleCounter(ct)))).toBe(true);
  });
});
