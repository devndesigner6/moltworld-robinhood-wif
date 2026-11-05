import http from "http";
import algosdk from "algosdk";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactAvmScheme as FacilitatorExactAvmScheme } from "@x402/avm/exact/facilitator";
import { ExactAvmScheme as ClientExactAvmScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { assembleCounter, counterBoxName, type CounterTerms } from "../../src/mandates/counter.js";

/**
 * End-to-end harness: a mock algod, a facilitator running the reference
 * @x402/avm facilitator logic (signature checks, amount/receiver/asset checks,
 * fee-payer rules) over a simulated ledger, and real @x402 clients that build
 * and sign genuine Algorand transaction groups.
 */

export const TESTNET_GENESIS = "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const NETWORKS = [`algorand:${TESTNET_GENESIS}`, "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe"];
export const USDC = 10458941;

export interface Chain {
  balances: Map<string, number>;
  round: number;
  settled: Array<{ txid: string; from: string; to: string; amount: number; lsig: boolean }>;
  failNextSettle: boolean;
  /** Called for lsig-signed payments so tests can model program evaluation. */
  lsigCheck?: (stxn: algosdk.SignedTransaction, group: algosdk.SignedTransaction[], index: number) => string | null;
  /** A modeled mandate spend counter (src/mandates/counter.ts), evaluated like the AVM would. */
  counter?: CounterTerms & { appId: number; boxes: Map<string, { start: number; spent: number }> };
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// Browsers build payments against this ledger in the local stack, so it answers cross-origin.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** A merchant record shaped like the facilitator's /data/merchants/:id answer, for the stats page. */
function merchantFixture() {
  const day = 86_400_000;
  const start = Date.UTC(2026, 9, 12);
  const resource = (id: string, path: string, settles: number, volume: number, price: number) => ({ id, url: `https://moltworld.xyz${path}`, method: "POST", settles, volume, price, priceAsset: "USDC" });
  return {
    id: "414f1538ce0d6de4",
    address: "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU",
    accounts: [
      { network: { slug: "algorand-testnet", name: "Algorand Testnet", testnet: true }, address: "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU", status: "active" },
      { network: { slug: "algorand-mainnet", name: "Algorand", testnet: false }, address: "NAPHTASVPDGRYORRYM237OSPA26R2TRRG4XFRRFK7K5H64H6HIIIZZIIXY", status: "active" },
    ],
    bazaar: true,
    challenge: true,
    volume: 1204.5,
    settles: 2053,
    successRate: 0.9977,
    payers: 54,
    avgTicket: 0.5868,
    avgSettleMs: 79.9,
    firstSeen: start,
    lastSeen: start + 14 * day,
    networks: [
      { network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k", slug: "algorand-mainnet", name: "Algorand", volume: 1204.46, events: 2049, testnet: false },
      { network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", slug: "algorand-testnet", name: "Algorand Testnet", volume: 0.04, events: 4, testnet: true },
    ],
    resources: [
      resource("r1", "/v1/models/sora-2-pro/videos/generations", 709, 730.5, 1.03),
      resource("r2", "/v1/models/gpt-4o/chat/completions", 640, 2.18, 0.003413),
      resource("r3", "/v1/models/flux-2-pro/images/generations", 410, 25.6, 0.06),
      resource("r4", "/v1/models/tts-1/audio/speech", 120, 0.4, 0.003),
      resource("r5", "/v1/market/demo-api/call", 40, 0.2, 0.005),
    ],
  };
}

export async function startHarness() {
  const chain: Chain = { balances: new Map(), round: 1_000_000, settled: [], failNextSettle: false };

  const algod = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/v2/transactions/params") {
      return send(res, 200, {
        "consensus-version": "test",
        fee: 0,
        "genesis-hash": TESTNET_GENESIS,
        "genesis-id": "testnet-v1.0",
        "last-round": chain.round,
        "min-fee": 1000,
      });
    }
    if (url.pathname === "/v2/status") return send(res, 200, { "last-round": chain.round });
    const app = url.pathname.match(/^\/v2\/applications\/(\d+)$/);
    if (app && chain.counter && Number(app[1]) === chain.counter.appId) {
      return send(res, 200, { id: chain.counter.appId, params: { "approval-program": Buffer.from(assembleCounter(chain.counter)).toString("base64") } });
    }
    const asset = url.pathname.match(/^\/v2\/accounts\/([A-Z2-7]+)\/assets\/(\d+)$/);
    if (asset) {
      const amount = chain.balances.get(asset[1]);
      if (amount === undefined) return send(res, 404, { message: "account asset info not found" });
      return send(res, 200, { round: chain.round, "asset-holding": { amount, "asset-id": Number(asset[2]), "is-frozen": false } });
    }
    send(res, 404, { message: `mock algod: no route ${url.pathname}` });
  });
  const algodUrl = await listen(algod);

  const feePayer = algosdk.generateAccount();
  const feePayerAddress = feePayer.addr.toString();

  // The spend counter's logic (see src/mandates/counter.ts), applied in group order.
  const countSpend = (group: algosdk.SignedTransaction[], i: number, pending: Array<() => void>): string | null => {
    const c = chain.counter!;
    const txn = group[i].txn;
    const args = txn.applicationCall?.appArgs ?? [];
    if (txn.applicationCall?.onComplete !== algosdk.OnApplicationComplete.NoOpOC || args.length !== 4 || new TextDecoder().decode(args[0]) !== "spend") return "counter: bad call";
    const prev = group[i - 1]?.txn;
    if (!prev || prev.type !== "axfer" || prev.sender.toString() !== txn.sender.toString()) return "counter: no payment before the call";
    const t = prev.assetTransfer!;
    if (Number(t.assetIndex) !== c.assetId || t.receiver.toString() !== c.payTo || Number(t.amount) < c.minAmountMicro) return "counter: not a Moltworld payment";
    const key = Buffer.from(counterBoxName(txn.sender.toString(), args[1])).toString("hex");
    const cap = Number(Buffer.from(args[2]).readBigUInt64BE());
    const window = Number(Buffer.from(args[3]).readBigUInt64BE());
    let box = c.boxes.get(key) ?? { start: 0, spent: 0 };
    if (chain.round >= box.start + window) box = { start: chain.round, spent: 0 };
    const spent = box.spent + Number(t.amount);
    if (spent > cap) return `counter: cap of ${cap} reached (would be ${spent})`;
    pending.push(() => c.boxes.set(key, { start: box.start, spent }));
    return null;
  };

  const evaluate = (signed: Uint8Array[], commit = false): string | null => {
    const group = signed.map((bytes) => algosdk.decodeSignedTransaction(bytes));
    // A group is atomic: counter updates apply only if every transaction passes.
    const pending: Array<() => void> = [];
    for (let i = 0; i < group.length; i++) {
      const stxn = group[i];
      const txn = stxn.txn;
      if (stxn.lsig) {
        const problem = chain.lsigCheck?.(stxn, group, i) ?? null;
        if (problem) return `logic eval error: ${problem}`;
      }
      if (txn.type === "appl" && chain.counter && Number(txn.applicationCall!.appIndex) === chain.counter.appId) {
        const problem = countSpend(group, i, pending);
        if (problem) return `logic eval error: ${problem}`;
        continue;
      }
      if (txn.type !== "axfer") continue;
      const from = txn.sender.toString();
      const amount = Number(txn.assetTransfer!.amount);
      const balance = chain.balances.get(from) ?? 0;
      if (balance < amount) return `overspend: ${from} holds ${balance}, needs ${amount}`;
    }
    if (commit) pending.forEach((apply) => apply());
    return null;
  };

  const facilitatorSigner = {
    getAddresses: () => [feePayerAddress],
    signTransaction: async (txnBytes: Uint8Array) => algosdk.decodeUnsignedTransaction(txnBytes).signTxn(feePayer.sk),
    getAlgodClient: () => {
      throw new Error("not used");
    },
    simulateTransactions: async (txns: Uint8Array[]) => {
      const failure = evaluate(txns);
      return { txnGroups: [failure ? { failureMessage: failure } : {}] } as any;
    },
    sendTransactions: async (txns: Uint8Array[]) => {
      if (chain.failNextSettle) {
        chain.failNextSettle = false;
        throw new Error("mock network rejected the group");
      }
      const failure = evaluate(txns, true);
      if (failure) throw new Error(failure);
      let id = "";
      for (const bytes of txns) {
        const stxn = algosdk.decodeSignedTransaction(bytes);
        const txn = stxn.txn;
        if (txn.type !== "axfer") continue;
        const from = txn.sender.toString();
        const to = txn.assetTransfer!.receiver.toString();
        const amount = Number(txn.assetTransfer!.amount);
        chain.balances.set(from, (chain.balances.get(from) ?? 0) - amount);
        chain.balances.set(to, (chain.balances.get(to) ?? 0) + amount);
        id = txn.txID();
        chain.settled.push({ txid: id, from, to, amount, lsig: !!stxn.lsig });
      }
      return id;
    },
    waitForConfirmation: async () => ({}),
  };

  const facilitator = new x402Facilitator();
  facilitator.register(NETWORKS as any, new FacilitatorExactAvmScheme(facilitatorSigner as any));

  const facilitatorServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/supported") return send(res, 200, facilitator.getSupported());
      if (req.method === "GET" && url.pathname.startsWith("/data/merchants/")) return send(res, 200, merchantFixture());
      const body = await readJson(req);
      if (req.method === "POST" && url.pathname === "/verify") {
        return send(res, 200, await facilitator.verify(body.paymentPayload, body.paymentRequirements));
      }
      if (req.method === "POST" && url.pathname === "/settle") {
        return send(res, 200, await facilitator.settle(body.paymentPayload, body.paymentRequirements));
      }
      send(res, 404, { error: "not found" });
    } catch (err: any) {
      send(res, 500, { error: err.message });
    }
  });
  const facilitatorUrl = await listen(facilitatorServer);

  return {
    chain,
    algodUrl,
    facilitatorUrl,
    feePayerAddress,
    async close() {
      await new Promise((r) => algod.close(r));
      await new Promise((r) => facilitatorServer.close(r));
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** A funded agent wallet with a payment-enabled fetch bound to the in-process app. */
export function createPayer(harness: Harness, appFetch: (req: Request) => Promise<Response>, usdcMicro = 5_000_000) {
  const account = algosdk.generateAccount();
  const address = account.addr.toString();
  harness.chain.balances.set(address, usdcMicro);
  const signer = toClientAvmSigner(Buffer.from(account.sk).toString("base64"));
  return { account, address, fetch: paymentFetch(harness, appFetch, signer) };
}

export function paymentFetch(harness: Harness, appFetch: (req: Request) => Promise<Response>, signer: any) {
  const client = new x402Client();
  for (const network of NETWORKS) client.register(network as any, new ClientExactAvmScheme(signer, { algodUrl: harness.algodUrl }));
  const base = (input: RequestInfo | URL, init?: RequestInit) => appFetch(new Request(input as any, init));
  return wrapFetchWithPayment(base as typeof fetch, client);
}
