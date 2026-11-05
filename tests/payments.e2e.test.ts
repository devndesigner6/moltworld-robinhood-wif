import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import algosdk from "algosdk";
import crypto from "crypto";
import { createPayer, Harness, startHarness, paymentFetch } from "./helpers/harness.js";

/**
 * Full payment lifecycle against real x402 clients and the reference facilitator
 * logic. Covers settlement, receipts, rebates, refunds, replay protection,
 * concurrency guards, video jobs, mandates and the marketplace.
 */

let harness: Harness;
let app: any;
let gateway: typeof import("../src/payments/gateway.js");
let ledger: typeof import("../src/ledger/index.js");
let receipts: typeof import("../src/receipts/index.js");
let mock: typeof import("../src/providers/mock.js");
let payouts: typeof import("../src/workers/payouts.js");
let jobs: typeof import("../src/workers/jobs.js");
let mandates: typeof import("../src/mandates/index.js");
let market: typeof import("../src/routes/market.js");
let config: typeof import("../src/config.js").config;

const appFetch = (req: Request) => app.fetch(req) as Promise<Response>;
const sent: Array<{ to: string; amountMicro: number; note: string }[]> = [];

beforeAll(async () => {
  harness = await startHarness();
  process.env.FACILITATOR_URL = harness.facilitatorUrl;
  process.env.ALGOD_URL = harness.algodUrl;
  process.env.ADMIN_TOKEN = "test-admin-token";
  process.env.PUBLIC_DOMAIN = "http://localhost";
  const appModule = await import("../src/app.js");
  app = appModule.app;
  await appModule.init();
  gateway = await import("../src/payments/gateway.js");
  ledger = await import("../src/ledger/index.js");
  receipts = await import("../src/receipts/index.js");
  mock = await import("../src/providers/mock.js");
  payouts = await import("../src/workers/payouts.js");
  jobs = await import("../src/workers/jobs.js");
  mandates = await import("../src/mandates/index.js");
  market = await import("../src/routes/market.js");
  config = (await import("../src/config.js")).config;
  payouts.setPayoutSender(async (transfers) => {
    sent.push(transfers);
    return `PAYOUT${sent.length}`.padEnd(52, "X");
  });
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(() => {
  mock.mockControls.reset();
  harness.chain.failNextSettle = false;
});

const chatBody = (content = "What is x402?", max_tokens = 200) => ({ messages: [{ role: "user", content }], max_tokens });

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Records the Payment-Signature of the paid retry so tests can replay it. */
function capturingFetch() {
  const captured: string[] = [];
  const fn = async (req: Request) => {
    const sig = req.headers.get("payment-signature");
    if (sig) captured.push(sig);
    return appFetch(req);
  };
  return { fn, captured };
}

async function verifyReceipt(header: string) {
  const receipt = receipts.decodeReceiptHeader(header);
  const keys = await (await appFetch(new Request("http://localhost/.well-known/moltworld-receipts.json"))).json();
  const key = keys.keys.find((k: any) => k.kid === receipt.kid);
  expect(key).toBeTruthy();
  const valid = receipts.verifyReceiptWithKey(receipt, receipts.publicKeyFromRaw(Buffer.from(key.publicKey, "base64")));
  return { receipt, valid };
}

describe("pre-payment checks", () => {
  it("rejects invalid bodies with 400 before asking for payment", async () => {
    const res = await appFetch(post("/v1/models/gpt/chat/completions", { messages: [] }));
    expect(res.status).toBe(400);
    expect(res.headers.get("payment-required")).toBeNull();
    expect((await res.json()).error.message).toContain("No payment was taken");
  });

  it("returns 404 for unknown models and wrong operations, never 402", async () => {
    expect((await appFetch(post("/v1/models/nope/chat/completions", chatBody()))).status).toBe(404);
    expect((await appFetch(post("/v1/models/gpt/images/generations", { prompt: "x" }))).status).toBe(404);
    const retired = await appFetch(post("/v1/models/gpt-image-1/images/generations", { prompt: "x" }));
    expect(retired.status).toBe(404);
    expect(retired.headers.get("payment-required")).toBeNull();
  });

  it("rejects an unverified OpenAI image model before asking for payment", async () => {
    const { defaultModelRegistry } = await import("../src/models/registry.js");
    defaultModelRegistry.markUnverified("gpt-image-1.5", "not listed for this OpenAI account");
    try {
      const res = await appFetch(post("/v1/models/gpt-image-1.5/images/generations", { prompt: "x" }));
      expect(res.status).toBe(503);
      expect(res.headers.get("payment-required")).toBeNull();
      expect((await res.json()).error.message).toContain("No payment was taken");
    } finally { defaultModelRegistry.clearUnverified("gpt-image-1.5"); }
  });

  it("quotes a 402 for exactly the amount /v1/quote returns", async () => {
    const body = chatBody("Explain atomic transfers", 300);
    const quote = await (await appFetch(post("/v1/quote", { model: "gpt-4o", ...body }))).json();
    const res = await appFetch(post("/v1/models/gpt-4o/chat/completions", body));
    expect(res.status).toBe(402);
    const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString());
    expect(required.accepts[0].amount).toBe(String(quote.quote.microUsdc));
    expect(required.accepts[0].payTo).toBe(config.payToAddress);
    expect(res.headers.get("moltworld-quote")).toBe(quote.quote.formattedPrice);
  });

  it("prices larger max_tokens higher, and never below the floor", async () => {
    const small = await (await appFetch(post("/v1/quote", { model: "gpt-4o", ...chatBody("hi", 10) }))).json();
    const large = await (await appFetch(post("/v1/quote", { model: "gpt-4o", ...chatBody("hi", 2000) }))).json();
    expect(large.quote.microUsdc).toBeGreaterThan(small.quote.microUsdc);
    expect(small.quote.microUsdc).toBeGreaterThanOrEqual(1000);
  });

  it("serves a 402 to a bare probe so crawlers can discover terms", async () => {
    const res = await appFetch(new Request("http://localhost/v1/models/gpt/chat/completions", { method: "POST" }));
    expect(res.status).toBe(402);
  });
});

describe("chat (authorization flow)", () => {
  it("serves, settles on-chain and returns a verifiable receipt bound to the payment", async () => {
    const payer = createPayer(harness, appFetch);
    const before = harness.chain.balances.get(payer.address)!;
    const res = await payer.fetch("http://localhost/v1/models/gpt-4o/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-payer-address": "SPOOFED", "x-txid": "SPOOFED" },
      body: JSON.stringify(chatBody("What is x402?", 2000)),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const body = JSON.parse(new TextDecoder().decode(bytes));
    expect(body.choices[0].message.content).toContain("[mock gpt-4o]");

    const { receipt, valid } = await verifyReceipt(res.headers.get("moltworld-receipt")!);
    expect(valid).toBe(true);
    const settlement = harness.chain.settled.at(-1)!;
    expect(receipt.txid).toBe(settlement.txid);
    expect(receipt.payer).toBe(payer.address); // not the spoofed header
    expect(receipt.responseSha256).toBe(receipts.sha256Hex(bytes));
    expect(receipt.requestSha256).toBe(receipts.sha256Hex(JSON.stringify(chatBody("What is x402?", 2000))));
    expect(harness.chain.balances.get(payer.address)).toBe(before - receipt.amountMicro);

    const record = await ledger.getRequest(receipt.id);
    expect(record?.status).toBe("completed");
    expect(record?.txid).toBe(settlement.txid);
    // Mock usage is far below the max_tokens budget, so most of it is rebated.
    expect(record!.rebate_micro).toBeGreaterThan(0);
    expect(await ledger.unpaidBalance(payer.address, "rebate")).toBe(record!.rebate_micro);
  });

  it("replays the original response for a retried Payment-Signature without charging again", async () => {
    const payer = createPayer(harness, appFetch);
    const capture = capturingFetch();
    const signer = (await import("@x402/avm")).toClientAvmSigner(Buffer.from(payer.account.sk).toString("base64"));
    const pay = paymentFetch(harness, capture.fn, signer);
    const first = await pay("http://localhost/v1/models/gpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody("replay me")),
    });
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const settledCount = harness.chain.settled.length;

    const again = await appFetch(post("/v1/models/gpt/chat/completions", chatBody("replay me"), { "Payment-Signature": capture.captured[0] }));
    expect(again.status).toBe(200);
    expect(again.headers.get("moltworld-replay")).toBe("true");
    expect(await again.text()).toBe(firstText);
    expect(harness.chain.settled.length).toBe(settledCount);
  });

  it("does not charge when the upstream fails", async () => {
    const payer = createPayer(harness, appFetch);
    const before = harness.chain.balances.get(payer.address);
    mock.mockControls.failNext = 1;
    const res = await payer.fetch("http://localhost/v1/models/gpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("not charged");
    expect(harness.chain.balances.get(payer.address)).toBe(before);
    const id = res.headers.get("moltworld-request-id")!;
    expect((await ledger.getRequest(id))?.status).toBe("failed");
  });

  it("withholds output when settlement fails after the work ran", async () => {
    const payer = createPayer(harness, appFetch);
    harness.chain.failNextSettle = true;
    const res = await payer.fetch("http://localhost/v1/models/gpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody("secret answer")),
    });
    expect(res.status).toBe(402);
    expect(await res.text()).not.toContain("secret answer");
    const id = res.headers.get("moltworld-request-id")!;
    expect((await ledger.getRequest(id))?.status).toBe("settle_failed");
  });

  it("caps concurrent unsettled requests at the wallet's USDC balance", async () => {
    const quote = await (await appFetch(post("/v1/quote", { model: "gpt-4o", ...chatBody("concurrency", 1000) }))).json();
    const amount = quote.quote.microUsdc;
    // Enough for one request, not two.
    const payer = createPayer(harness, appFetch, Math.floor(amount * 1.5));
    mock.mockControls.delayMs = 150;
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        payer.fetch("http://localhost/v1/models/gpt-4o/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody("concurrency", 1000)),
        })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(mock.mockControls.calls).toBe(1); // the refused requests never reached the upstream
    expect(harness.chain.balances.get(payer.address)).toBe(Math.floor(amount * 1.5) - amount);
  });
});

describe("image and voice (upfront flow)", () => {
  it("settles before generation and returns a receipt", async () => {
    const payer = createPayer(harness, appFetch);
    const res = await payer.fetch("http://localhost/v1/models/gpt-image-1.5/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a lighthouse" }),
    });
    expect(res.status).toBe(200);
    const { valid, receipt } = await verifyReceipt(res.headers.get("moltworld-receipt")!);
    expect(valid).toBe(true);
    expect(receipt.model).toBe("gpt-image-1.5");
  });

  it("refunds on-chain when the upstream fails after settlement", async () => {
    const payer = createPayer(harness, appFetch);
    const before = harness.chain.balances.get(payer.address)!;
    mock.mockControls.failNext = 1;
    const res = await payer.fetch("http://localhost/v1/models/tts-1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello world" }),
    });
    expect(res.status).toBe(502);
    expect(res.headers.get("moltworld-refund")).toBe("pending");
    const id = res.headers.get("moltworld-request-id")!;
    const record = await ledger.getRequest(id);
    expect(record?.status).toBe("refund_pending");
    expect(harness.chain.balances.get(payer.address)).toBe(before - record!.amount_micro);

    const result = await payouts.processRefunds();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const refundTransfer = sent.flat().find((t) => t.note === `moltworld-refund:${id}`);
    expect(refundTransfer).toEqual({ to: payer.address, amountMicro: record!.amount_micro, note: `moltworld-refund:${id}` });
    expect((await ledger.getRequest(id))?.status).toBe("refunded");
    // A second run never pays the same refund twice.
    await payouts.processRefunds();
    expect(sent.flat().filter((t) => t.note === `moltworld-refund:${id}`)).toHaveLength(1);
  });

  it("leaves refunds pending (never 'sent') when no payout wallet is configured", async () => {
    payouts.setPayoutSender(null);
    const result = await payouts.processRefunds();
    expect(result.skipped).toBe(true);
    payouts.setPayoutSender(async (transfers) => {
      sent.push(transfers);
      return `PAYOUT${sent.length}`.padEnd(52, "X");
    });
  });
});

describe("removed model endpoints", () => {
  it("never asks for payment for fal.ai or retired model endpoints", async () => {
    const removed = {
      image: ["gpt-image-1", "flux-2-pro", "recraft-v4.1-flash", "qwen-image-3", "seedream-5.0", "grok-imagine-image", "recraft-v3"],
      video: ["veo-3.1-fast", "kling-v3.0-std", "wan-3.0", "hailuo-3", "sora-2-pro"],
    };
    for (const [kind, models] of Object.entries(removed)) {
      for (const model of models) {
        const path = kind === "image" ? "images/generations" : "videos/generations";
        const res = await appFetch(post(`/v1/models/${model}/${path}`, { prompt: "x" }));
        expect(res.status).toBe(404);
        expect(res.headers.get("payment-required")).toBeNull();
        const quote = await appFetch(post("/v1/quote", { model, prompt: "x" }));
        expect(quote.status).toBe(404);
      }
    }
  });
});

describe("spending mandates", () => {
  async function setupMandate(opts: { maxPerCallUsd: number; dailyCapUsd: number; allowed?: string[] }) {
    const owner = algosdk.generateAccount();
    const agent = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 10_000_000);
    const draft = await (
      await appFetch(
        post("/v1/mandates/draft", {
          owner: owner.addr.toString(),
          agent: agent.addr.toString(),
          max_per_call_usd: opts.maxPerCallUsd,
          daily_cap_usd: opts.dailyCapUsd,
          allowed_models: opts.allowed,
          label: "test agent",
        })
      )
    ).json();
    const program = new Uint8Array(Buffer.from(draft.program_b64, "base64"));
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(owner.sk);
    const registration = { ...draft.registration, issued_at: Math.floor(Date.now() / 1000) };
    const res = await appFetch(
      post("/v1/mandates", {
        program_b64: draft.program_b64,
        delegation_sig: Buffer.from(lsig.lsig.sig!).toString("base64"),
        registration,
        owner_sig: mandates.signOwnerMessage(registration, owner.sk),
      })
    );
    expect(res.status).toBe(201);
    // Agent-side signer: signs the payment with the delegated LogicSig as the owner, and the
    // agent's own key co-signs the transaction id. Without that key, `withoutAgentKey` pays.
    const signerWith = (agentSk: Uint8Array | null) => ({
      address: owner.addr.toString(),
      signTransactions: async (txns: Uint8Array[], indexes?: number[]) =>
        txns.map((t, i) => {
          if (indexes && !indexes.includes(i)) return null;
          const txn = algosdk.decodeUnsignedTransaction(t);
          lsig.lsig.args = agentSk ? [algosdk.tealSignFromProgram(agentSk, txn.rawTxID(), program)] : [];
          return algosdk.signLogicSigTransactionObject(txn, lsig).blob;
        }),
    });
    return {
      owner,
      draft,
      lsig,
      pay: paymentFetch(harness, appFetch, signerWith(agent.sk)),
      withoutAgentKey: paymentFetch(harness, appFetch, signerWith(null)),
      withKey: (sk: Uint8Array) => paymentFetch(harness, appFetch, signerWith(sk)),
    };
  }

  beforeAll(() => {
    // Model the mandate program's on-chain checks in the simulated ledger.
    harness.chain.lsigCheck = (stxn) => {
      if (stxn.txn.type !== "axfer") return null; // models the payment branch only
      const terms = mandates.parseMandateProgram(stxn.lsig!.logic);
      if (!terms) return "not a mandate";
      if (!mandates.verifyDelegation(stxn.lsig!.logic, Buffer.from(stxn.lsig!.sig!).toString("base64"), stxn.txn.sender.toString())) return "bad delegation";
      const t = stxn.txn;
      if (t.assetTransfer!.receiver.toString() !== terms.payTo) return "receiver";
      if (Number(t.assetTransfer!.amount) > terms.maxPerCallMicro) return "amount over per-call max";
      if (Number(t.fee) !== 0) return "fee";
      if (Number(t.lastValid) > terms.expiryRound) return "expired";
      const agentSig = stxn.lsig!.args?.[0];
      if (terms.agent && !(agentSig && mandates.verifyAgentSignature(stxn.lsig!.logic, t.rawTxID(), agentSig, terms.agent))) return "agent signature";
      return null;
    };
  });

  it("lets an agent pay as the owner within the mandate", async () => {
    const { owner, pay } = await setupMandate({ maxPerCallUsd: 0.5, dailyCapUsd: 2 });
    const res = await pay("http://localhost/v1/models/gpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    expect(res.status).toBe(200);
    const last = harness.chain.settled.at(-1)!;
    expect(last.lsig).toBe(true);
    expect(last.from).toBe(owner.addr.toString());
  });

  it("refuses a leaked credential: without the agent's own key nothing can be paid", async () => {
    const { withoutAgentKey, withKey } = await setupMandate({ maxPerCallUsd: 0.5, dailyCapUsd: 2 });
    const settledBefore = harness.chain.settled.length;
    for (const pay of [withoutAgentKey, withKey(algosdk.generateAccount().sk)]) {
      const res = await pay("http://localhost/v1/models/gpt/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody()),
      });
      expect(res.status).toBe(402);
      expect(await res.text()).toContain("mandate_agent_signature_invalid");
    }
    expect(harness.chain.settled.length).toBe(settledBefore);
  });

  it("only drafts and registers mandates bound to a separate agent key", async () => {
    const owner = algosdk.generateAccount();
    const noAgent = await appFetch(post("/v1/mandates/draft", { owner: owner.addr.toString(), max_per_call_usd: 1, daily_cap_usd: 5 }));
    expect(noAgent.status).toBe(400);
    const sameKey = await appFetch(post("/v1/mandates/draft", { owner: owner.addr.toString(), agent: owner.addr.toString(), max_per_call_usd: 1, daily_cap_usd: 5 }));
    expect(sameKey.status).toBe(400);

    const unbound = mandates.assembleMandate({
      payTo: config.payToAddress,
      assetId: Number(config.usdcAsaId),
      maxPerCallMicro: 1_000_000,
      expiryRound: harness.chain.round + 100_000,
      salt: mandates.newMandateSalt(),
    });
    const lsig = new algosdk.LogicSigAccount(unbound);
    lsig.sign(owner.sk);
    const registration = { action: "register", mandate_id: mandates.mandateId(unbound), owner: owner.addr.toString(), label: "x", daily_cap_micro: 5_000_000, allowed_models: null, issued_at: Math.floor(Date.now() / 1000) };
    const res = await appFetch(
      post("/v1/mandates", {
        program_b64: Buffer.from(unbound).toString("base64"),
        delegation_sig: Buffer.from(lsig.lsig.sig!).toString("base64"),
        registration,
        owner_sig: mandates.signOwnerMessage(registration, owner.sk),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("agent");
  });

  it("refuses a mandate registered before agent binding, which could pay with the credential alone", async () => {
    const owner = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 10_000_000);
    const expiryRound = harness.chain.round + 100_000;
    const program = mandates.assembleMandate({ payTo: config.payToAddress, assetId: Number(config.usdcAsaId), maxPerCallMicro: 1_000_000, expiryRound, salt: mandates.newMandateSalt() });
    // A row as the gateway stored it before new mandates had to name an agent.
    await ledger.upsertMandate({
      id: mandates.mandateId(program),
      owner: owner.addr.toString(),
      label: "legacy",
      program_b64: Buffer.from(program).toString("base64"),
      max_per_call_micro: 1_000_000,
      expiry_round: expiryRound,
      daily_cap_micro: 5_000_000,
      allowed_models: null,
    });
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(owner.sk);
    const pay = paymentFetch(harness, appFetch, {
      address: owner.addr.toString(),
      signTransactions: async (txns: Uint8Array[], indexes?: number[]) =>
        txns.map((t, i) => (indexes && !indexes.includes(i) ? null : algosdk.signLogicSigTransactionObject(algosdk.decodeUnsignedTransaction(t), lsig).blob)),
    });
    const settledBefore = harness.chain.settled.length;
    const res = await pay("http://localhost/v1/models/gpt-4o/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody("legacy", 200)),
    });
    expect(res.status).toBe(402);
    expect(await res.text()).toContain("mandate_not_bound");
    expect(harness.chain.settled.length).toBe(settledBefore);
  });

  it("enforces the daily cap, model allow-list and revocation", async () => {
    const quote = await (await appFetch(post("/v1/quote", { model: "gpt-4o", ...chatBody("cap", 2000) }))).json();
    const perCall = quote.quote.finalPriceUsd;
    const { owner, draft, pay } = await setupMandate({ maxPerCallUsd: perCall * 1.2, dailyCapUsd: perCall * 1.5, allowed: ["gpt-4o"] });
    const call = (model: string) =>
      pay(`http://localhost/v1/models/${model}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody("cap", 2000)),
      });

    const notAllowed = await call("gpt");
    expect(notAllowed.status).toBe(402);
    expect(await notAllowed.text()).toContain("mandate_model_not_allowed");

    expect((await call("gpt-4o")).status).toBe(200);
    const overCap = await call("gpt-4o");
    expect(overCap.status).toBe(402);
    expect(await overCap.text()).toContain("mandate_daily_cap_exceeded");

    const revoke = { action: "revoke", mandate_id: draft.mandate_id, issued_at: Math.floor(Date.now() / 1000) };
    const revoked = await appFetch(post(`/v1/mandates/${draft.mandate_id}/revoke`, { ...revoke, owner_sig: mandates.signOwnerMessage(revoke, owner.sk) }));
    expect(revoked.status).toBe(200);
    const after = await call("gpt-4o");
    expect(after.status).toBe(402);
    expect(await after.text()).toContain("mandate_not_active");
  });

  it("refuses to register a mandate without the owner's signatures", async () => {
    const owner = algosdk.generateAccount();
    const attacker = algosdk.generateAccount();
    const draft = await (
      await appFetch(post("/v1/mandates/draft", { owner: owner.addr.toString(), agent: algosdk.generateAccount().addr.toString(), max_per_call_usd: 1, daily_cap_usd: 5 }))
    ).json();
    const lsig = new algosdk.LogicSigAccount(new Uint8Array(Buffer.from(draft.program_b64, "base64")));
    lsig.sign(owner.sk);
    const registration = { ...draft.registration, daily_cap_micro: 999_000_000, issued_at: Math.floor(Date.now() / 1000) };
    const res = await appFetch(
      post("/v1/mandates", {
        program_b64: draft.program_b64,
        delegation_sig: Buffer.from(lsig.lsig.sig!).toString("base64"),
        registration,
        owner_sig: mandates.signOwnerMessage(registration, attacker.sk),
      })
    );
    expect(res.status).toBe(401);
  });

  it("refuses payments from an unregistered mandate program", async () => {
    const owner = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 5_000_000);
    const program = mandates.assembleMandate({
      payTo: config.payToAddress,
      assetId: Number(config.usdcAsaId),
      maxPerCallMicro: 1_000_000,
      expiryRound: harness.chain.round + 100_000,
      salt: mandates.newMandateSalt(),
    });
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(owner.sk);
    const signer = {
      address: owner.addr.toString(),
      signTransactions: async (txns: Uint8Array[], indexes?: number[]) =>
        txns.map((t, i) => (indexes && !indexes.includes(i) ? null : algosdk.signLogicSigTransactionObject(algosdk.decodeUnsignedTransaction(t), lsig).blob)),
    };
    const res = await paymentFetch(harness, appFetch, signer)("http://localhost/v1/models/gpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    expect(res.status).toBe(402);
    expect(await res.text()).toContain("mandate_not_active");
  });
});

describe("creator marketplace", () => {
  it("lists, reviews, sells and pays out a creator API", async () => {
    const creator = algosdk.generateAccount();
    const slug = `weather-${crypto.randomBytes(4).toString("hex")}`;
    const listing = {
      action: "list",
      creator: creator.addr.toString(),
      slug,
      name: "Weather Oracle",
      description: "Current weather for a city, as JSON.",
      upstream_url: "https://weather.example.com/v1/now",
      price_usd: 0.02,
      input_example: { city: "Lagos" },
      issued_at: Math.floor(Date.now() / 1000),
    };
    const created = await appFetch(post("/v1/market/listings", { listing, creator_sig: mandates.signOwnerMessage(listing, creator.sk) }));
    expect(created.status).toBe(201);
    const { signing_secret, listing: view } = await created.json();
    expect(view.status).toBe("pending");

    // Not sellable until reviewed.
    expect((await appFetch(post(`/v1/market/${slug}/call`, { city: "Lagos" }))).status).toBe(404);

    const forwarded: any[] = [];
    market.setCreatorFetcherForTests(async (url, init) => {
      forwarded.push({ url, init });
      return { status: 200, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify({ tempC: 31 })) };
    });
    const pending = await (await appFetch(new Request("http://localhost/v1/ops/listings?status=pending", { headers: { Authorization: "Bearer test-admin-token" } }))).json();
    const id = pending.data.find((l: any) => l.slug === slug).id;
    expect(pending.data[0].signing_secret).toBeUndefined();
    const review = await appFetch(post(`/v1/ops/listings/${id}/review`, { status: "approved" }, { Authorization: "Bearer test-admin-token" }));
    expect(review.status).toBe(200);

    const payer = createPayer(harness, appFetch);
    const res = await payer.fetch(`http://localhost/v1/market/${slug}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Lagos" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tempC: 31 });
    expect(harness.chain.settled.at(-1)!.amount).toBe(20_000);

    // The creator can authenticate the forwarded call.
    const h = forwarded[0].init.headers;
    const expected = market.signForCreator(signing_secret, h["X-Moltworld-Timestamp"], h["X-Moltworld-Request-Id"], forwarded[0].init.body);
    expect(h["X-Moltworld-Signature"]).toBe(expected);
    expect(h["X-Moltworld-Payer"]).toBe(payer.address);

    const earnings = await (await appFetch(new Request(`http://localhost/v1/market/creators/${creator.addr}/earnings`))).json();
    expect(earnings.unpaid).toBe("$0.017"); // 85% of $0.02
    market.setCreatorFetcherForTests(null);
  });

  it("rejects listings pointing at private addresses", async () => {
    const creator = algosdk.generateAccount();
    const listing = {
      action: "list",
      creator: creator.addr.toString(),
      slug: `probe-${crypto.randomBytes(4).toString("hex")}`,
      name: "Probe",
      description: "Tries to reach metadata services.",
      upstream_url: "https://169.254.169.254/latest",
      price_usd: 0.01,
      issued_at: Math.floor(Date.now() / 1000),
    };
    const res = await appFetch(post("/v1/market/listings", { listing, creator_sig: mandates.signOwnerMessage(listing, creator.sk) }));
    expect(res.status).toBe(400);
  });
});

describe("payouts and stats", () => {
  it("batches rebates over the threshold into one atomic group", async () => {
    const before = sent.length;
    // Seed a large rebate balance for two wallets.
    for (const [i, addr] of [algosdk.generateAccount(), algosdk.generateAccount()].map((a, i) => [i, a.addr.toString()] as const)) {
      const id = ledger.newId("req");
      const db = await (await import("../src/ledger/db.js")).getDatabase();
      await db.query(
        `INSERT INTO mw_requests (id, payment_hash, kind, resource, payer, pay_to, network, asset, amount_micro, payment_flow, status)
         VALUES ($1,$2,'model','/x',$3,'P','N','A',100000,'authorization','completed')`,
        [id, crypto.randomBytes(16).toString("hex"), addr]
      );
      await ledger.addCredit(addr, "rebate", 60_000 + i, id);
    }
    const result = await payouts.processPayouts();
    expect(result.sent).toBeGreaterThanOrEqual(2);
    const group = sent[before];
    expect(group.length).toBeGreaterThanOrEqual(2);
    expect(group.every((t) => t.note.startsWith("moltworld-rebate:"))).toBe(true);
  });

  it("reports ledger-backed stats with txids", async () => {
    const stats = await (await appFetch(new Request("http://localhost/v1/stats"))).json();
    expect(stats.metrics.completed_requests).toBeGreaterThan(3);
    expect(stats.metrics.unique_paying_wallets).toBeGreaterThan(1);
    expect(stats.recent_settlements[0].txid).toMatch(/^[A-Z2-7]{52}$/);
  });

  it("protects operator endpoints", async () => {
    expect((await appFetch(new Request("http://localhost/v1/ops/refunds"))).status).toBe(401);
    const ok = await appFetch(new Request("http://localhost/v1/ops/refunds", { headers: { Authorization: "Bearer test-admin-token" } }));
    expect(ok.status).toBe(200);
  });
});
