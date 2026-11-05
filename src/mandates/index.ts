import algosdk from "algosdk";
import crypto from "crypto";
import { canonicalJson } from "../receipts/index.js";

/**
 * Agent spending mandates.
 *
 * An owner delegates a small, auditable LogicSig program to an agent. The agent
 * can then sign x402 payments *as the owner's account*, but the Algorand
 * protocol itself only lets those payments:
 *   - be USDC asset transfers,
 *   - go to Moltworld's payTo address and nowhere else,
 *   - carry at most `maxPerCallMicro` per transaction,
 *   - pay zero fee (the x402 facilitator sponsors fees), never close out or rekey,
 *   - be valid only until `expiryRound`,
 *   - carry a signature from the agent's own key over the transaction id, when the
 *     mandate names an agent. The credential an agent is given then cannot spend on
 *     its own: the agent's private key never leaves the agent.
 * Moltworld additionally enforces, per registered mandate, a rolling 24h spend
 * cap and a model allow-list, and refuses payments from revoked mandates. Because
 * the payee is pinned to Moltworld, a server-side revocation stops all spending.
 */

export interface MandateTerms {
  payTo: string;
  assetId: number;
  maxPerCallMicro: number;
  expiryRound: number;
  /** 16 random bytes so every mandate has a distinct program (and id). */
  salt: Uint8Array;
  /** Address of the agent key that must co-sign every payment (absent on legacy mandates). */
  agent?: string;
  /**
   * On-chain cap per window, enforced by the spend counter app (see counter.ts). Every
   * payment must be followed by a call to `appId` carrying this salt, cap and window.
   * Requires `agent`.
   */
  counter?: { appId: number; capMicro: number; windowRounds: number };
}

/** About a day of Algorand rounds (~2.9s each): the window of a capped mandate. */
export const ROUNDS_PER_DAY = 30_000;

const OP = {
  txn: 0x31,
  global: 0x32,
  pushbytes: 0x80,
  pushint: 0x81,
  arg0: 0x2d,
  ed25519verify: 0x04,
  add: 0x08,
  sub: 0x09,
  bnz: 0x40,
  ret: 0x43,
  gtxns: 0x38,
  gtxnsa: 0x39,
  eq: 0x12,
  lte: 0x0e,
  assert: 0x44,
  pop: 0x48,
} as const;

const TXN = {
  Fee: 1, LastValid: 4, TypeEnum: 16, XferAsset: 17, AssetAmount: 18, AssetSender: 19, AssetReceiver: 20, AssetCloseTo: 21,
  GroupIndex: 22, TxID: 23, ApplicationID: 24, OnCompletion: 25, ApplicationArgs: 26, RekeyTo: 32,
} as const;
const TYPE_APPL = 6;
const GLOBAL_ZERO_ADDRESS = 3;
const TYPE_AXFER = 4;
const TEAL_VERSION = 8;

function uvarint(value: number | bigint): number[] {
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

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function u64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}

/** TEAL source of a mandate. Kept byte-for-byte equivalent to assembleMandate(). */
export function mandateTeal(t: MandateTerms): string {
  if (t.counter) return cappedMandateTeal(t, t.counter);
  const payTo = algosdk.decodeAddress(t.payTo).publicKey;
  return [
    `#pragma version ${TEAL_VERSION}`,
    "// Moltworld agent spending mandate (delegated LogicSig)",
    "txn TypeEnum", `pushint ${TYPE_AXFER}`, "==", "assert",
    "txn XferAsset", `pushint ${t.assetId}`, "==", "assert",
    "txn AssetReceiver", `pushbytes 0x${hex(payTo)}`, "==", "assert",
    "txn AssetAmount", `pushint ${t.maxPerCallMicro}`, "<=", "assert",
    "txn AssetCloseTo", "global ZeroAddress", "==", "assert",
    "txn AssetSender", "global ZeroAddress", "==", "assert",
    "txn RekeyTo", "global ZeroAddress", "==", "assert",
    "txn Fee", "pushint 0", "==", "assert",
    "txn LastValid", `pushint ${t.expiryRound}`, "<=", "assert",
    ...(t.agent ? ["// the agent's own key signs this transaction id (arg 0)", "txn TxID", "arg_0", `pushbytes 0x${hex(algosdk.decodeAddress(t.agent).publicKey)}`, "ed25519verify", "assert"] : []),
    `pushbytes 0x${hex(t.salt)}`, "pop",
    "pushint 1",
    "",
  ].join("\n");
}

/** A capped mandate: the payment branch also requires the spend counter call that follows it. */
function cappedMandateTeal(t: MandateTerms, c: NonNullable<MandateTerms["counter"]>): string {
  if (!t.agent) throw new Error("A capped mandate must be bound to an agent.");
  const next = (field: string) => ["txn GroupIndex", "pushint 1", "+", field];
  return [
    `#pragma version ${TEAL_VERSION}`,
    "// Moltworld agent spending mandate (delegated LogicSig), capped on-chain per window",
    "txn TypeEnum", `pushint ${TYPE_APPL}`, "==", "bnz counter",
    "txn TypeEnum", `pushint ${TYPE_AXFER}`, "==", "assert",
    "txn XferAsset", `pushint ${t.assetId}`, "==", "assert",
    "txn AssetReceiver", `pushbytes 0x${hex(algosdk.decodeAddress(t.payTo).publicKey)}`, "==", "assert",
    "txn AssetAmount", `pushint ${t.maxPerCallMicro}`, "<=", "assert",
    "txn AssetCloseTo", "global ZeroAddress", "==", "assert",
    "txn AssetSender", "global ZeroAddress", "==", "assert",
    "txn RekeyTo", "global ZeroAddress", "==", "assert",
    "txn Fee", "pushint 0", "==", "assert",
    "txn LastValid", `pushint ${t.expiryRound}`, "<=", "assert",
    "// the agent's own key signs this transaction id (arg 0)",
    "txn TxID", "arg_0", `pushbytes 0x${hex(algosdk.decodeAddress(t.agent).publicKey)}`, "ed25519verify", "assert",
    "// the spend counter is called right after this payment, with this mandate's salt, cap and window",
    ...next("gtxns ApplicationID"), `pushint ${c.appId}`, "==", "assert",
    ...next("gtxnsa ApplicationArgs 1"), `pushbytes 0x${hex(t.salt)}`, "==", "assert",
    ...next("gtxnsa ApplicationArgs 2"), `pushbytes 0x${hex(u64(c.capMicro))}`, "==", "assert",
    ...next("gtxnsa ApplicationArgs 3"), `pushbytes 0x${hex(u64(c.windowRounds))}`, "==", "assert",
    "pushint 1", "return",
    "counter:",
    "// the counter call: this app only, no-op, no fee, no rekey, right after a payment",
    "txn ApplicationID", `pushint ${c.appId}`, "==", "assert",
    "txn OnCompletion", "pushint 0", "==", "assert",
    "txn RekeyTo", "global ZeroAddress", "==", "assert",
    "txn Fee", "pushint 0", "==", "assert",
    "txn LastValid", `pushint ${t.expiryRound}`, "<=", "assert",
    "txn GroupIndex", "pushint 1", "-", "gtxns TypeEnum", `pushint ${TYPE_AXFER}`, "==", "assert",
    "pushint 1", "return",
    "",
  ].join("\n");
}

function assembleCappedMandate(t: MandateTerms, c: NonNullable<MandateTerms["counter"]>): Uint8Array {
  if (!t.agent) throw new Error("A capped mandate must be bound to an agent.");
  const b: number[] = [TEAL_VERSION];
  const txn = (field: number) => b.push(OP.txn, field);
  const pushint = (v: number) => b.push(OP.pushint, ...uvarint(v));
  const pushbytes = (bytes: Uint8Array) => b.push(OP.pushbytes, ...uvarint(bytes.length), ...bytes);
  const zero = () => b.push(OP.global, GLOBAL_ZERO_ADDRESS);
  const next = () => { txn(TXN.GroupIndex); pushint(1); b.push(OP.add); };

  txn(TXN.TypeEnum); pushint(TYPE_APPL); b.push(OP.eq, OP.bnz, 0, 0);
  const branchEnd = b.length;
  txn(TXN.TypeEnum); pushint(TYPE_AXFER); b.push(OP.eq, OP.assert);
  txn(TXN.XferAsset); pushint(t.assetId); b.push(OP.eq, OP.assert);
  txn(TXN.AssetReceiver); pushbytes(algosdk.decodeAddress(t.payTo).publicKey); b.push(OP.eq, OP.assert);
  txn(TXN.AssetAmount); pushint(t.maxPerCallMicro); b.push(OP.lte, OP.assert);
  txn(TXN.AssetCloseTo); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.AssetSender); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.RekeyTo); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.Fee); pushint(0); b.push(OP.eq, OP.assert);
  txn(TXN.LastValid); pushint(t.expiryRound); b.push(OP.lte, OP.assert);
  txn(TXN.TxID); b.push(OP.arg0); pushbytes(algosdk.decodeAddress(t.agent).publicKey); b.push(OP.ed25519verify, OP.assert);
  next(); b.push(OP.gtxns, TXN.ApplicationID); pushint(c.appId); b.push(OP.eq, OP.assert);
  next(); b.push(OP.gtxnsa, TXN.ApplicationArgs, 1); pushbytes(t.salt); b.push(OP.eq, OP.assert);
  next(); b.push(OP.gtxnsa, TXN.ApplicationArgs, 2); pushbytes(u64(c.capMicro)); b.push(OP.eq, OP.assert);
  next(); b.push(OP.gtxnsa, TXN.ApplicationArgs, 3); pushbytes(u64(c.windowRounds)); b.push(OP.eq, OP.assert);
  pushint(1); b.push(OP.ret);
  const offset = b.length - branchEnd;
  b[branchEnd - 2] = (offset >> 8) & 0xff;
  b[branchEnd - 1] = offset & 0xff;
  txn(TXN.ApplicationID); pushint(c.appId); b.push(OP.eq, OP.assert);
  txn(TXN.OnCompletion); pushint(0); b.push(OP.eq, OP.assert);
  txn(TXN.RekeyTo); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.Fee); pushint(0); b.push(OP.eq, OP.assert);
  txn(TXN.LastValid); pushint(t.expiryRound); b.push(OP.lte, OP.assert);
  txn(TXN.GroupIndex); pushint(1); b.push(OP.sub, OP.gtxns, TXN.TypeEnum); pushint(TYPE_AXFER); b.push(OP.eq, OP.assert);
  pushint(1); b.push(OP.ret);
  return new Uint8Array(b);
}

/** Assembles the mandate program locally, so verification never depends on an algod endpoint. */
export function assembleMandate(t: MandateTerms): Uint8Array {
  if (t.salt.length !== 16) throw new Error("Mandate salt must be 16 bytes.");
  if (t.counter) return assembleCappedMandate(t, t.counter);
  const payTo = algosdk.decodeAddress(t.payTo).publicKey;
  const b: number[] = [TEAL_VERSION];
  const txn = (field: number) => b.push(OP.txn, field);
  const pushint = (v: number) => b.push(OP.pushint, ...uvarint(v));
  const pushbytes = (bytes: Uint8Array) => b.push(OP.pushbytes, ...uvarint(bytes.length), ...bytes);
  const zero = () => b.push(OP.global, GLOBAL_ZERO_ADDRESS);

  txn(TXN.TypeEnum); pushint(TYPE_AXFER); b.push(OP.eq, OP.assert);
  txn(TXN.XferAsset); pushint(t.assetId); b.push(OP.eq, OP.assert);
  txn(TXN.AssetReceiver); pushbytes(payTo); b.push(OP.eq, OP.assert);
  txn(TXN.AssetAmount); pushint(t.maxPerCallMicro); b.push(OP.lte, OP.assert);
  txn(TXN.AssetCloseTo); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.AssetSender); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.RekeyTo); zero(); b.push(OP.eq, OP.assert);
  txn(TXN.Fee); pushint(0); b.push(OP.eq, OP.assert);
  txn(TXN.LastValid); pushint(t.expiryRound); b.push(OP.lte, OP.assert);
  if (t.agent) {
    txn(TXN.TxID); b.push(OP.arg0); pushbytes(algosdk.decodeAddress(t.agent).publicKey); b.push(OP.ed25519verify, OP.assert);
  }
  pushbytes(t.salt); b.push(OP.pop);
  pushint(1);
  return new Uint8Array(b);
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
    if (shift > 63n) throw new Error("varint too long");
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("integer too large");
  return { value: Number(result), next: i };
}

/**
 * Recognises a mandate program and extracts its terms. Returns null for any other
 * program. Recognition is strict: the program must re-assemble to identical bytes.
 */
export function parseMandateProgram(program: Uint8Array): MandateTerms | null {
  try {
    const ints: number[] = [];
    const blobs: Uint8Array[] = [];
    for (let i = 1; i < program.length; ) {
      const op = program[i++];
      if (op === OP.pushint) {
        const r = readUvarint(program, i);
        ints.push(r.value);
        i = r.next;
      } else if (op === OP.pushbytes) {
        const r = readUvarint(program, i);
        blobs.push(program.slice(r.next, r.next + r.value));
        i = r.next + r.value;
      } else if (op === OP.txn || op === OP.global || op === OP.gtxns) {
        i++;
      } else if (op === OP.gtxnsa || op === OP.bnz) {
        i += 2;
      }
    }
    // Capped: pushints 6, 4, asset, max, 0, expiry, 1, app, 1, 1, 1, 1, app, 0, 0, expiry, 1, 4, 1;
    // pushbytes payTo, agent, salt, cap, window.
    if (ints.length === 19 && blobs.length === 5) {
      const read64 = (x: Uint8Array) => (x.length === 8 ? Number(new DataView(x.buffer, x.byteOffset, 8).getBigUint64(0)) : NaN);
      const capped: MandateTerms = {
        payTo: algosdk.encodeAddress(blobs[0]),
        assetId: ints[2],
        maxPerCallMicro: ints[3],
        expiryRound: ints[5],
        salt: blobs[2],
        agent: algosdk.encodeAddress(blobs[1]),
        counter: { appId: ints[7], capMicro: read64(blobs[3]), windowRounds: read64(blobs[4]) },
      };
      return Buffer.from(assembleMandate(capped)).equals(Buffer.from(program)) ? capped : null;
    }
    // pushints: TYPE_AXFER, asset, max, 0 (fee), expiry, 1 ; pushbytes: payTo, [agent], salt
    if (ints.length !== 6 || (blobs.length !== 2 && blobs.length !== 3) || blobs[0].length !== 32) return null;
    const bound = blobs.length === 3;
    if (bound && blobs[1].length !== 32) return null;
    const terms: MandateTerms = {
      payTo: algosdk.encodeAddress(blobs[0]),
      assetId: ints[1],
      maxPerCallMicro: ints[2],
      expiryRound: ints[4],
      salt: blobs[bound ? 2 : 1],
      ...(bound ? { agent: algosdk.encodeAddress(blobs[1]) } : {}),
    };
    const rebuilt = assembleMandate(terms);
    return Buffer.from(rebuilt).equals(Buffer.from(program)) ? terms : null;
  } catch {
    return null;
  }
}

/** A mandate's id is the program's own Algorand address (hash of the program). */
export function mandateId(program: Uint8Array): string {
  return new algosdk.LogicSigAccount(program).address().toString();
}

export function newMandateSalt(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(16));
}

/** Verifies the owner's delegation signature over the program ("Program" || program). */
export function verifyDelegation(program: Uint8Array, signatureB64: string, owner: string): boolean {
  try {
    const sig = Buffer.from(signatureB64, "base64");
    const message = Buffer.concat([Buffer.from("Program"), Buffer.from(program)]);
    const publicKey = algosdk.decodeAddress(owner).publicKey;
    return crypto.verify(
      null,
      message,
      crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]), format: "der", type: "spki" }),
      sig
    );
  } catch {
    return false;
  }
}

/**
 * Checks the agent's co-signature on a mandate payment: ed25519 over
 * "ProgData" || program address || txid, exactly what the program's ed25519verify checks.
 */
export function verifyAgentSignature(program: Uint8Array, txid: Uint8Array, signature: Uint8Array, agent: string): boolean {
  try {
    const programHash = new algosdk.LogicSigAccount(program).address().publicKey;
    const message = Buffer.concat([Buffer.from("ProgData"), Buffer.from(programHash), Buffer.from(txid)]);
    const publicKey = algosdk.decodeAddress(agent).publicKey;
    return crypto.verify(
      null,
      message,
      crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey)]), format: "der", type: "spki" }),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * The signed payment transaction of an x402 AVM payload. Decoded from plain bytes:
 * algosdk rejects LogicSig arguments (the agent's co-signature) decoded from a Buffer.
 */
function paymentTxn(payload: any): algosdk.SignedTransaction {
  const group: string[] = payload?.payload?.paymentGroup;
  const index: number = payload?.payload?.paymentIndex ?? 0;
  if (!Array.isArray(group) || !group[index]) throw new Error("No payment transaction in the payload.");
  return algosdk.decodeSignedTransaction(new Uint8Array(Buffer.from(group[index], "base64")));
}

/** For an agent-bound mandate payment, whether its LogicSig carries a valid agent co-signature. */
export function agentSignatureValid(payload: any, terms: MandateTerms): boolean {
  if (!terms.agent) return true;
  try {
    const stxn = paymentTxn(payload);
    const sig = stxn.lsig?.args?.[0];
    return !!sig && verifyAgentSignature(stxn.lsig!.logic, stxn.txn.rawTxID(), sig, terms.agent);
  } catch {
    return false;
  }
}

/** Owner-signed control messages (register / revoke) use algosdk's "MX"-prefixed signBytes. */
export function verifyOwnerMessage(message: Record<string, unknown>, signatureB64: string, owner: string): boolean {
  try {
    return algosdk.verifyBytes(new TextEncoder().encode(canonicalJson(message)), Buffer.from(signatureB64, "base64"), owner);
  } catch {
    return false;
  }
}

export function signOwnerMessage(message: Record<string, unknown>, sk: Uint8Array): string {
  return Buffer.from(algosdk.signBytes(new TextEncoder().encode(canonicalJson(message)), sk)).toString("base64");
}

/** Pulls the LogicSig program out of an x402 AVM payment payload, if the payment is lsig-signed. */
export function logicSigProgramFromPayload(payload: any): Uint8Array | null {
  try {
    return paymentTxn(payload).lsig?.logic ?? null;
  } catch {
    return null;
  }
}

/**
 * Canonical identity of an x402 AVM payment: the Algorand txid of its payment
 * transaction. Re-encoding the same signed payment cannot produce a new key.
 */
export function paymentTxidFromPayload(payload: any): string | null {
  try {
    return paymentTxn(payload).txn.txID();
  } catch {
    return null;
  }
}

export function paymentTxidFromHeader(header: string): string | null {
  try {
    return paymentTxidFromPayload(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
  } catch {
    return null;
  }
}

export function payerFromPayload(payload: any): string | null {
  try {
    return paymentTxn(payload).txn.sender.toString();
  } catch {
    return null;
  }
}
