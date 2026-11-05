import algosdk from "algosdk";
import { canonicalJson } from "./receipts.js";
import { bytesEqual, fromBase64, toBase64, utf8 } from "./encoding.js";
import { u64, verifyCounterApp } from "./counter.js";

/**
 * Mandate tooling. The owner never signs a program they have not checked:
 * verifyDraft() re-assembles the program from the requested limits and refuses
 * anything that differs by a single byte. Every mandate is bound to an agent key
 * the agent generates itself, so the credential the owner hands over cannot pay
 * without the agent's own signature.
 */

export interface MandateTerms {
  payTo: string;
  assetId: number;
  maxPerCallMicro: number;
  expiryRound: number;
  salt: Uint8Array;
  /** Address of the agent key that must co-sign every payment. */
  agent?: string;
  /** On-chain cap per window, enforced by the spend counter app. Requires `agent`. */
  counter?: { appId: number; capMicro: number; windowRounds: number };
}

/** USD to micro-USDC exactly as the gateway rounds it, so drafts compare byte for byte. */
export function usdToMicro(usd: number): number {
  return Math.ceil(Number((usd * 1_000_000).toFixed(4)));
}

/** About a day of Algorand rounds: the shortest cap window an owner accepts. */
export const ROUNDS_PER_DAY = 30_000;

function uvarint(value: number): number[] {
  let v = BigInt(value);
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}

/** Capped mandate: the payment must be followed by the spend counter call (mirrors the gateway). */
function assembleCappedMandate(t: MandateTerms, c: NonNullable<MandateTerms["counter"]>): Uint8Array {
  if (!t.agent) throw new Error("A capped mandate must be bound to an agent.");
  const b: number[] = [8];
  const txn = (f: number) => b.push(0x31, f);
  const int = (v: number) => b.push(0x81, ...uvarint(v));
  const bytes = (x: Uint8Array) => b.push(0x80, ...uvarint(x.length), ...x);
  const zero = () => b.push(0x32, 3);
  const eq = () => b.push(0x12, 0x44);
  const next = () => { txn(22); int(1); b.push(0x08); };
  txn(16); int(6); b.push(0x12, 0x40, 0, 0);
  const branchEnd = b.length;
  txn(16); int(4); eq();
  txn(17); int(t.assetId); eq();
  txn(20); bytes(algosdk.decodeAddress(t.payTo).publicKey); eq();
  txn(18); int(t.maxPerCallMicro); b.push(0x0e, 0x44);
  txn(21); zero(); eq();
  txn(19); zero(); eq();
  txn(32); zero(); eq();
  txn(1); int(0); eq();
  txn(4); int(t.expiryRound); b.push(0x0e, 0x44);
  txn(23); b.push(0x2d); bytes(algosdk.decodeAddress(t.agent).publicKey); b.push(0x04, 0x44);
  next(); b.push(0x38, 24); int(c.appId); eq();
  next(); b.push(0x39, 26, 1); bytes(t.salt); eq();
  next(); b.push(0x39, 26, 2); bytes(u64(c.capMicro)); eq();
  next(); b.push(0x39, 26, 3); bytes(u64(c.windowRounds)); eq();
  int(1); b.push(0x43);
  const offset = b.length - branchEnd;
  b[branchEnd - 2] = (offset >> 8) & 0xff;
  b[branchEnd - 1] = offset & 0xff;
  txn(24); int(c.appId); eq();
  txn(25); int(0); eq();
  txn(32); zero(); eq();
  txn(1); int(0); eq();
  txn(4); int(t.expiryRound); b.push(0x0e, 0x44);
  txn(22); int(1); b.push(0x09, 0x38, 16); int(4); eq();
  int(1); b.push(0x43);
  return new Uint8Array(b);
}

export function assembleMandate(t: MandateTerms): Uint8Array {
  if (t.counter) return assembleCappedMandate(t, t.counter);
  const payTo = algosdk.decodeAddress(t.payTo).publicKey;
  const b: number[] = [8];
  const txn = (f: number) => b.push(0x31, f);
  const int = (v: number) => b.push(0x81, ...uvarint(v));
  const bytes = (x: Uint8Array) => b.push(0x80, ...uvarint(x.length), ...x);
  const zero = () => b.push(0x32, 3);
  const eq = () => b.push(0x12, 0x44);
  txn(16); int(4); eq();
  txn(17); int(t.assetId); eq();
  txn(20); bytes(payTo); eq();
  txn(18); int(t.maxPerCallMicro); b.push(0x0e, 0x44);
  txn(21); zero(); eq();
  txn(19); zero(); eq();
  txn(32); zero(); eq();
  txn(1); int(0); eq();
  txn(4); int(t.expiryRound); b.push(0x0e, 0x44);
  // txn TxID; arg_0; pushbytes <agent>; ed25519verify; assert
  if (t.agent) { txn(23); b.push(0x2d); bytes(algosdk.decodeAddress(t.agent).publicKey); b.push(0x04, 0x44); }
  bytes(t.salt); b.push(0x48);
  int(1);
  return new Uint8Array(b);
}

export interface MandateDraft {
  mandate_id: string;
  program_b64: string;
  terms: {
    pay_to: string;
    asset_id: number;
    max_per_call_micro: number;
    expiry_round: number;
    current_round: number;
    agent?: string;
    counter?: { app_id: number; cap_micro: number; window_rounds: number } | null;
  };
  registration: Record<string, unknown>;
}

/** Throws unless the draft is exactly a Moltworld mandate with the limits you asked for. */
export function verifyDraft(
  draft: MandateDraft,
  expected: {
    payTo: string;
    maxPerCallMicro: number;
    assetId: number;
    agent: string;
    maxValidRounds?: number;
    /** The on-chain cap you asked for, and the counter app you checked (see verifyCounterApp). */
    counter?: { appId: number; capMicro: number };
  }
): Uint8Array {
  if (expected.maxValidRounds !== undefined && draft.terms.expiry_round - draft.terms.current_round > expected.maxValidRounds) {
    throw new Error("Mandate draft is valid for longer than requested. Do not sign it.");
  }
  const program = fromBase64(draft.program_b64);
  // Only the random salt is taken from the draft; every limit is rebuilt from what was asked.
  const salt = mandateTermsFromProgram(program)?.salt;
  if (!salt) throw new Error("Mandate draft is not a Moltworld mandate program. Do not sign it.");
  const rebuilt = assembleMandate({
    payTo: expected.payTo,
    assetId: expected.assetId,
    maxPerCallMicro: expected.maxPerCallMicro,
    expiryRound: draft.terms.expiry_round,
    salt,
    agent: expected.agent,
    ...(expected.counter
      ? (() => {
          const window = draft.terms.counter?.window_rounds ?? 0;
          // A longer window only tightens the cap; a shorter one would loosen it.
          if (window < ROUNDS_PER_DAY) throw new Error("Mandate draft's cap window is shorter than a day. Do not sign it.");
          return { counter: { appId: expected.counter.appId, capMicro: expected.counter.capMicro, windowRounds: window } };
        })()
      : {}),
  });
  if (!bytesEqual(rebuilt, program)) {
    throw new Error("Mandate draft does not match the requested payee, asset, per-call limit or agent. Do not sign it.");
  }
  if (new algosdk.LogicSigAccount(program).address().toString() !== draft.mandate_id) {
    throw new Error("Mandate id does not match the program.");
  }
  return program;
}

export function signOwnerMessage(message: Record<string, unknown>, sk: Uint8Array): string {
  return toBase64(algosdk.signBytes(utf8(canonicalJson(message)), sk));
}

/** What the owner gives an agent. Contains no private key, and cannot pay without the agent's own key. */
export interface MandateCredential {
  owner: string;
  programB64: string;
  delegationSigB64: string;
}

/** An agent's own signing key. The agent generates and keeps it; only its address is shared. */
export interface AgentKey {
  address: string;
  /** Base64 64-byte ed25519 secret key. Keep it on the agent's machine. */
  secretKeyB64: string;
}

export function generateAgentKey(): AgentKey {
  const account = algosdk.generateAccount();
  return { address: account.addr.toString(), secretKeyB64: toBase64(account.sk) };
}

export function agentKeyFromSecret(secretKeyB64: string): AgentKey {
  const sk = fromBase64(secretKeyB64);
  if (sk.length !== 64) throw new Error("Agent key must be a base64 64-byte ed25519 secret key.");
  return { address: new algosdk.Address(sk.slice(32)).toString(), secretKeyB64 };
}

function readUvarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  for (;;) {
    if (i >= bytes.length) throw new Error("truncated varint");
    const byte = bytes[i++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: Number(result), next: i };
}

/** Terms of a mandate program, or null if it is not one. Strict: it must re-assemble to the same bytes. */
export function mandateTermsFromProgram(program: Uint8Array): MandateTerms | null {
  try {
    const ints: number[] = [];
    const blobs: Uint8Array[] = [];
    for (let i = 1; i < program.length; ) {
      const op = program[i++];
      if (op === 0x81) { const r = readUvarint(program, i); ints.push(r.value); i = r.next; }
      else if (op === 0x80) { const r = readUvarint(program, i); blobs.push(program.slice(r.next, r.next + r.value)); i = r.next + r.value; }
      else if (op === 0x31 || op === 0x32 || op === 0x38) i++;
      else if (op === 0x39 || op === 0x40) i += 2;
    }
    const address = (x: Uint8Array) => new algosdk.Address(x).toString();
    const read64 = (x: Uint8Array) => Number(new DataView(x.buffer, x.byteOffset, 8).getBigUint64(0));
    let terms: MandateTerms;
    if (ints.length === 19 && blobs.length === 5) {
      terms = {
        payTo: address(blobs[0]), assetId: ints[2], maxPerCallMicro: ints[3], expiryRound: ints[5], salt: blobs[2], agent: address(blobs[1]),
        counter: { appId: ints[7], capMicro: read64(blobs[3]), windowRounds: read64(blobs[4]) },
      };
    } else if (ints.length === 6 && (blobs.length === 2 || blobs.length === 3)) {
      const bound = blobs.length === 3;
      terms = { payTo: address(blobs[0]), assetId: ints[1], maxPerCallMicro: ints[2], expiryRound: ints[4], salt: blobs[bound ? 2 : 1], ...(bound ? { agent: address(blobs[1]) } : {}) };
    } else return null;
    return bytesEqual(assembleMandate(terms), program) ? terms : null;
  } catch {
    return null;
  }
}

/** The agent this mandate's program is bound to, or null for a legacy unbound mandate. */
export function mandateAgent(credential: MandateCredential): string | null {
  return mandateTermsFromProgram(fromBase64(credential.programB64))?.agent ?? null;
}

/**
 * Signs payments under a mandate. For a bound mandate (all new ones) the agent's key
 * co-signs each transaction id; the credential alone is refused by Algorand.
 */
export function createMandateSigner(credential: MandateCredential, agentSecretKeyB64?: string) {
  const program = fromBase64(credential.programB64);
  const lsig = new algosdk.LogicSigAccount(program);
  lsig.lsig.sig = fromBase64(credential.delegationSigB64);
  // A delegated LogicSig also carries the delegating account's public key.
  lsig.sigkey = algosdk.decodeAddress(credential.owner).publicKey;
  if (!lsig.verify()) throw new Error("Mandate credential's delegation signature does not match the owner.");
  const agent = mandateAgent(credential);
  let agentSk: Uint8Array | null = null;
  if (agent) {
    if (!agentSecretKeyB64) throw new Error(`This mandate is bound to agent ${agent}; provide that agent's key.`);
    const key = agentKeyFromSecret(agentSecretKeyB64);
    if (key.address !== agent) throw new Error(`Agent key ${key.address} is not the key this mandate is bound to (${agent}).`);
    agentSk = fromBase64(agentSecretKeyB64);
  }
  return {
    address: credential.owner,
    agent,
    async signTransactions(txns: Uint8Array[], indexesToSign?: number[]): Promise<(Uint8Array | null)[]> {
      return txns.map((bytes, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null;
        const txn = algosdk.decodeUnsignedTransaction(bytes);
        if (txn.sender.toString() !== credential.owner) throw new Error("Mandate signer only signs payments from the owner account.");
        // The agent's signature over this transaction id, checked on-chain by ed25519verify.
        lsig.lsig.args = agentSk ? [algosdk.tealSignFromProgram(agentSk, txn.rawTxID(), program)] : [];
        return algosdk.signLogicSigTransactionObject(txn, lsig).blob;
      });
    },
  };
}

/**
 * Owner flow in one call: draft on the gateway, verify the program locally,
 * delegate it, register caps. Returns the credential to hand to the agent.
 */
export async function createMandate(
  baseUrl: string,
  owner: algosdk.Account,
  options: {
    /** Address of the agent's own key (from generateAgentKey or `moltworld-mcp keygen`). */
    agent: string;
    maxPerCallUsd: number;
    dailyCapUsd: number;
    validDays?: number;
    allowedModels?: string[];
    label?: string;
    /** Algod used to check the spend counter's code; defaults to a public node. */
    algodUrl?: string;
  },
  fetch: typeof globalThis.fetch = globalThis.fetch
): Promise<{ mandateId: string; credential: MandateCredential }> {
  const base = baseUrl.replace(/\/$/, "");
  const health = await (await fetch(`${base}/health`)).json();
  const res = await fetch(`${base}/v1/mandates/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: owner.addr.toString(),
      agent: options.agent,
      max_per_call_usd: options.maxPerCallUsd,
      daily_cap_usd: options.dailyCapUsd,
      valid_days: options.validDays ?? 30,
      allowed_models: options.allowedModels,
      label: options.label,
    }),
  });
  if (!res.ok) throw new Error(`Mandate draft failed: ${await res.text()}`);
  const draft = (await res.json()) as MandateDraft;
  // When the gateway caps mandates on-chain, check the counter app's deployed code first.
  const counter = health.mandate_counter as { app_id: number; min_amount_micro: number; window_rounds: number } | null;
  const dailyCapMicro = usdToMicro(options.dailyCapUsd);
  if (counter) {
    const algodUrl = options.algodUrl ?? (health.network === "mainnet" ? "https://mainnet-api.algonode.cloud" : "https://testnet-api.algonode.cloud");
    // Asked of algod directly, never through the gateway that is being checked.
    await verifyCounterApp(algodUrl, counter.app_id, { payTo: health.pay_to, assetId: Number(health.usdc_asset_id), minAmountMicro: counter.min_amount_micro });
  }
  const program = verifyDraft(draft, {
    payTo: health.pay_to,
    assetId: Number(health.usdc_asset_id),
    maxPerCallMicro: usdToMicro(options.maxPerCallUsd),
    agent: options.agent,
    ...(counter ? { counter: { appId: counter.app_id, capMicro: dailyCapMicro } } : {}),
    maxValidRounds: Math.ceil(((options.validDays ?? 30) + 1) * 31_000),
  });
  const lsig = new algosdk.LogicSigAccount(program);
  lsig.sign(owner.sk);
  const delegationSigB64 = toBase64(lsig.lsig.sig!);
  const registration = { ...draft.registration, issued_at: Math.floor(Date.now() / 1000) };
  const reg = await fetch(`${base}/v1/mandates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ program_b64: draft.program_b64, delegation_sig: delegationSigB64, registration, owner_sig: signOwnerMessage(registration, owner.sk) }),
  });
  if (!reg.ok) throw new Error(`Mandate registration failed: ${await reg.text()}`);
  return { mandateId: draft.mandate_id, credential: { owner: owner.addr.toString(), programB64: draft.program_b64, delegationSigB64 } };
}

export async function revokeMandate(
  baseUrl: string,
  owner: algosdk.Account,
  mandateId: string,
  fetch: typeof globalThis.fetch = globalThis.fetch
): Promise<void> {
  const message = { action: "revoke", mandate_id: mandateId, issued_at: Math.floor(Date.now() / 1000) };
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/mandates/${mandateId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, owner_sig: signOwnerMessage(message, owner.sk) }),
  });
  if (!res.ok) throw new Error(`Revoke failed: ${await res.text()}`);
}
