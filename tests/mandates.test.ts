import { describe, expect, it } from "vitest";
import algosdk from "algosdk";
import {
  assembleMandate,
  mandateId,
  mandateTeal,
  newMandateSalt,
  parseMandateProgram,
  signOwnerMessage,
  verifyAgentSignature,
  verifyDelegation,
  verifyOwnerMessage,
} from "../src/mandates/index.js";
import { assembleCounter, counterBoxName, counterTeal, u64 } from "../src/mandates/counter.js";


const PAY_TO = "NAPHTASVPDGRYORRYM237OSPA26R2TRRG4XFRRFK7K5H64H6HIIIZZIIXY";
const TESTNET_ALGOD = "https://testnet-api.algonode.cloud";
const TESTNET_USDC = 10458941;
// The spend counter deployed on testnet (scripts/deployMandateCounter.ts), paying the testnet merchant.
const TESTNET_COUNTER = { appId: 775006909, payTo: "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU", assetId: TESTNET_USDC, minAmountMicro: 1000 };
// The production spend counter on mainnet, paying Moltworld's revenue address in mainnet USDC.
const MAINNET_ALGOD = "https://mainnet-api.algonode.cloud";
const MAINNET_COUNTER = { appId: 3755263517, payTo: PAY_TO, assetId: 31566704, minAmountMicro: 1000 };

const terms = (overrides: Partial<Parameters<typeof assembleMandate>[0]> = {}) => ({
  payTo: PAY_TO,
  assetId: TESTNET_USDC,
  maxPerCallMicro: 250_000,
  expiryRound: 90_000_000,
  salt: newMandateSalt(),
  ...overrides,
});

async function online(): Promise<boolean> {
  if (process.env.NETWORK_TESTS === "false") return false;
  try {
    return (await fetch(`${TESTNET_ALGOD}/health`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

describe("mandate program", () => {
  it("round-trips terms through assemble/parse", () => {
    const t = terms();
    const parsed = parseMandateProgram(assembleMandate(t));
    expect(parsed).toEqual(t);
  });

  it("does not recognise a tampered program", () => {
    const program = assembleMandate(terms());
    const tampered = new Uint8Array(program);
    tampered[tampered.length - 1] = 0; // pushint 1 -> pushint 0
    expect(parseMandateProgram(tampered)).toBeNull();
    expect(parseMandateProgram(new Uint8Array([8, 0x81, 1]))).toBeNull();
  });

  it("round-trips an agent-bound mandate and tells it apart from an unbound one", () => {
    const agent = algosdk.generateAccount().addr.toString();
    const bound = terms({ agent });
    expect(parseMandateProgram(assembleMandate(bound))).toEqual(bound);
    expect(parseMandateProgram(assembleMandate(terms()))?.agent).toBeUndefined();
    expect(mandateId(assembleMandate(bound))).not.toBe(mandateId(assembleMandate({ ...bound, agent: algosdk.generateAccount().addr.toString() })));
  });

  it("checks the agent's co-signature exactly as ed25519verify does", () => {
    const agent = algosdk.generateAccount();
    const program = assembleMandate(terms({ agent: agent.addr.toString() }));
    const txid = new Uint8Array(32).fill(7);
    const sig = algosdk.tealSignFromProgram(agent.sk, txid, program);
    expect(verifyAgentSignature(program, txid, sig, agent.addr.toString())).toBe(true);
    expect(verifyAgentSignature(program, new Uint8Array(32).fill(8), sig, agent.addr.toString())).toBe(false);
    expect(verifyAgentSignature(program, txid, algosdk.tealSignFromProgram(algosdk.generateAccount().sk, txid, program), agent.addr.toString())).toBe(false);
  });

  it("gives each mandate a distinct id", () => {
    expect(mandateId(assembleMandate(terms()))).not.toBe(mandateId(assembleMandate(terms())));
  });

  it("verifies the owner's delegation and control-message signatures", () => {
    const owner = algosdk.generateAccount();
    const other = algosdk.generateAccount();
    const program = assembleMandate(terms());
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(owner.sk);
    const sig = Buffer.from(lsig.lsig.sig!).toString("base64");
    expect(verifyDelegation(program, sig, owner.addr.toString())).toBe(true);
    expect(verifyDelegation(program, sig, other.addr.toString())).toBe(false);

    const message = { action: "revoke", mandate_id: "X", issued_at: 1 };
    expect(verifyOwnerMessage(message, signOwnerMessage(message, owner.sk), owner.addr.toString())).toBe(true);
    expect(verifyOwnerMessage({ ...message, issued_at: 2 }, signOwnerMessage(message, owner.sk), owner.addr.toString())).toBe(false);
  });
});

describe("mandate program on Algorand testnet", () => {
  it("compiles to exactly the locally assembled bytes", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const agent = algosdk.generateAccount().addr.toString();
    const capped = terms({ agent, counter: { appId: TESTNET_COUNTER.appId, capMicro: 5_000_000, windowRounds: 30_000 } });
    for (const t of [terms(), terms({ maxPerCallMicro: 1, expiryRound: 1 }), terms({ maxPerCallMicro: 2 ** 40 }), terms({ agent }), capped]) {
      const res = await fetch(`${TESTNET_ALGOD}/v2/teal/compile`, { method: "POST", body: mandateTeal(t) });
      const { result } = await res.json();
      expect(result).toBe(Buffer.from(assembleMandate(t)).toString("base64"));
    }
  });

  it("is enforced by the AVM: over-limit, wrong payee and fee-bearing payments are rejected by logic", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const algod = new algosdk.Algodv2("", TESTNET_ALGOD, 443);
    const sp = await algod.getTransactionParams().do();
    const owner = algosdk.generateAccount();
    const t = terms({ expiryRound: Number(sp.lastValid) + 10 });
    const lsig = new algosdk.LogicSigAccount(assembleMandate(t));
    lsig.sign(owner.sk);

    const simulate = async (amount: number, receiver = PAY_TO, fee = 0) => {
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: owner.addr,
        receiver,
        assetIndex: TESTNET_USDC,
        amount,
        suggestedParams: { ...sp, fee: BigInt(fee), flatFee: true },
      });
      const signed = algosdk.decodeSignedTransaction(algosdk.signLogicSigTransactionObject(txn, lsig).blob);
      const request = new algosdk.modelsv2.SimulateRequest({
        txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: [signed] })],
      });
      const result = await algod.simulateTransactions(request).do();
      return result.txnGroups[0].failureMessage ?? "";
    };

    // Within terms: the program approves; the unfunded test account then fails on balance.
    const ok = await simulate(t.maxPerCallMicro);
    expect(ok).not.toMatch(/rejected by logic|logic eval/i);
    for (const failure of [
      await simulate(t.maxPerCallMicro + 1),
      await simulate(1, algosdk.generateAccount().addr.toString()),
      await simulate(1, PAY_TO, 1000),
    ]) {
      expect(failure).toMatch(/rejected by logic|assert failed|logic eval/i);
    }
  });

  it("compiles the spend counter to exactly the locally assembled bytes", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const res = await fetch(`${TESTNET_ALGOD}/v2/teal/compile`, { method: "POST", body: counterTeal(TESTNET_COUNTER) });
    expect((await res.json()).result).toBe(Buffer.from(assembleCounter(TESTNET_COUNTER)).toString("base64"));
  });

  it("the deployed testnet counter runs exactly the audited code", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const app = await (await fetch(`${TESTNET_ALGOD}/v2/applications/${TESTNET_COUNTER.appId}`)).json();
    expect(app.params["approval-program"]).toBe(Buffer.from(assembleCounter(TESTNET_COUNTER)).toString("base64"));
  });

  it("the deployed mainnet counter runs exactly the audited code", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const app = await (await fetch(`${MAINNET_ALGOD}/v2/applications/${MAINNET_COUNTER.appId}`)).json();
    expect(app.params["approval-program"]).toBe(Buffer.from(assembleCounter(MAINNET_COUNTER)).toString("base64"));
    expect(app.params["global-state-schema"] ?? { "num-uint": 0, "num-byte-slice": 0 }).toEqual({ "num-uint": 0, "num-byte-slice": 0 });
  });

  // Needs a testnet account holding ALGO and USDC: TESTNET_OWNER_KEY=<base64 64-byte key>.
  it("is enforced by the AVM: a capped mandate pays only through the counter, within its cap", async (ctx) => {
    const ownerKey = process.env.TESTNET_OWNER_KEY;
    if (!ownerKey || !(await online())) return ctx.skip();
    const algod = new algosdk.Algodv2("", TESTNET_ALGOD, 443);
    const sp = await algod.getTransactionParams().do();
    const ownerSk = new Uint8Array(Buffer.from(ownerKey, "base64"));
    const owner = new algosdk.Address(ownerSk.slice(32)).toString();
    const agent = algosdk.generateAccount();
    const salt = newMandateSalt();
    const program = assembleMandate({
      payTo: TESTNET_COUNTER.payTo, assetId: TESTNET_COUNTER.assetId, maxPerCallMicro: 5000, expiryRound: Number(sp.lastValid) + 10, salt,
      agent: agent.addr.toString(), counter: { appId: TESTNET_COUNTER.appId, capMicro: 1500, windowRounds: 30_000 },
    });
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(ownerSk);

    const simulate = async (opts: { amount: number; withCounter?: boolean; capArg?: number; agentSigned?: boolean }) => {
      const params = { ...sp, fee: 0n, flatFee: true };
      const txns = [
        algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: owner, receiver: owner, amount: 0, suggestedParams: { ...params, fee: 3000n } }),
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: owner, receiver: TESTNET_COUNTER.payTo, assetIndex: TESTNET_COUNTER.assetId, amount: opts.amount, suggestedParams: params }),
        ...(opts.withCounter === false
          ? []
          : [algosdk.makeApplicationNoOpTxnFromObject({
              sender: owner, appIndex: TESTNET_COUNTER.appId,
              appArgs: [new TextEncoder().encode("spend"), salt, u64(opts.capArg ?? 1500), u64(30_000)],
              boxes: [{ appIndex: TESTNET_COUNTER.appId, name: counterBoxName(owner, salt) }],
              suggestedParams: params,
            })]),
      ];
      algosdk.assignGroupID(txns);
      const signed = txns.map((txn, i) => {
        if (i === 0) return algosdk.decodeSignedTransaction(txn.signTxn(ownerSk));
        lsig.lsig.args = i === 1 && opts.agentSigned !== false ? [algosdk.tealSignFromProgram(agent.sk, txn.rawTxID(), program)] : [];
        return algosdk.decodeSignedTransaction(algosdk.signLogicSigTransactionObject(txn, lsig).blob);
      });
      const request = new algosdk.modelsv2.SimulateRequest({ txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: signed })] });
      const result = await algod.simulateTransactions(request).do();
      return result.txnGroups[0].failureMessage ?? "";
    };

    expect(await simulate({ amount: 1000 })).toBe("");
    const rejected = /rejected by logic|assert failed|logic eval/i;
    expect(await simulate({ amount: 2000 })).toMatch(rejected); // over the 1500 cap: the counter refuses
    expect(await simulate({ amount: 1000, withCounter: false })).toMatch(rejected); // no counter call: the program refuses
    expect(await simulate({ amount: 1000, capArg: 1_000_000 })).toMatch(rejected); // a raised cap: the program refuses
    expect(await simulate({ amount: 1000, agentSigned: false })).toMatch(rejected); // no agent signature
  });

  it("is enforced by the AVM: a bound mandate pays only with its agent's signature", async (ctx) => {
    if (!(await online())) return ctx.skip();
    const algod = new algosdk.Algodv2("", TESTNET_ALGOD, 443);
    const sp = await algod.getTransactionParams().do();
    const owner = algosdk.generateAccount();
    const agent = algosdk.generateAccount();
    const program = assembleMandate(terms({ expiryRound: Number(sp.lastValid) + 10, agent: agent.addr.toString() }));
    const lsig = new algosdk.LogicSigAccount(program);
    lsig.sign(owner.sk);

    const simulate = async (signWith: Uint8Array | null) => {
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: owner.addr,
        receiver: PAY_TO,
        assetIndex: TESTNET_USDC,
        amount: 1,
        suggestedParams: { ...sp, fee: BigInt(0), flatFee: true },
      });
      lsig.lsig.args = signWith ? [algosdk.tealSignFromProgram(signWith, txn.rawTxID(), program)] : [new Uint8Array(64)];
      const signed = algosdk.decodeSignedTransaction(algosdk.signLogicSigTransactionObject(txn, lsig).blob);
      const request = new algosdk.modelsv2.SimulateRequest({
        txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: [signed] })],
      });
      const result = await algod.simulateTransactions(request).do();
      return result.txnGroups[0].failureMessage ?? "";
    };

    // With the agent's signature the program approves (the unfunded account then fails on balance).
    expect(await simulate(agent.sk)).not.toMatch(/rejected by logic|logic eval/i);
    // The owner's delegation alone, or another key, is rejected by the program.
    expect(await simulate(null)).toMatch(/rejected by logic|assert failed|logic eval/i);
    expect(await simulate(algosdk.generateAccount().sk)).toMatch(/rejected by logic|assert failed|logic eval/i);
  });
});
