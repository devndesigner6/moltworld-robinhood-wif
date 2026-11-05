import algosdk from "algosdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64, utf8 } from "./encoding.js";

/**
 * Client side of the mandate spend counter, an immutable Algorand app that enforces a
 * capped mandate's daily cap on-chain. Mirrors the gateway's src/mandates/counter.ts
 * byte for byte, so an owner can check the deployed app's code before signing.
 */

export interface CounterTerms {
  payTo: string;
  assetId: number;
  minAmountMicro: number;
}

export const SPEND_SELECTOR = "spend";

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

export function assembleCounter(t: CounterTerms): Uint8Array {
  const payTo = algosdk.decodeAddress(t.payTo).publicKey;
  const b: number[] = [8];
  const pushint = (v: number) => b.push(0x81, ...uvarint(v));
  const pushbytes = (x: Uint8Array) => b.push(0x80, ...uvarint(x.length), ...x);
  const txn = (f: number) => b.push(0x31, f);
  const gtxns = (f: number) => b.push(0x38, f);
  const store = (i: number) => b.push(0x35, i);
  const load = (i: number) => b.push(0x34, i);
  const [EQ, LTE, GTE, ASSERT, ADD, SUB] = [0x12, 0x0e, 0x0f, 0x44, 0x08, 0x09];
  const branch = (op: number) => { b.push(op, 0, 0); return b.length; };
  const land = (from: number) => { const off = b.length - from; b[from - 2] = (off >> 8) & 0xff; b[from - 1] = off & 0xff; };

  txn(24); const toCreate = branch(0x41);
  txn(25); pushint(0); b.push(EQ, ASSERT);
  txn(27); pushint(4); b.push(EQ, ASSERT);
  b.push(0x36, 26, 0); pushbytes(utf8(SPEND_SELECTOR)); b.push(EQ, ASSERT);
  txn(22); pushint(1); b.push(SUB); store(0);
  load(0); gtxns(16); pushint(4); b.push(EQ, ASSERT);
  load(0); gtxns(0); txn(0); b.push(EQ, ASSERT);
  load(0); gtxns(17); pushint(t.assetId); b.push(EQ, ASSERT);
  load(0); gtxns(20); pushbytes(payTo); b.push(EQ, ASSERT);
  load(0); gtxns(18); pushint(t.minAmountMicro); b.push(GTE, ASSERT);
  txn(0); b.push(0x36, 26, 1); b.push(0x50, 0x01); store(1);
  b.push(0x36, 26, 2); b.push(0x17); store(2);
  b.push(0x36, 26, 3); b.push(0x17); store(3);
  load(1); pushint(16); b.push(0xb9, 0x48);
  load(1); pushint(0); pushint(8); b.push(0xba, 0x17); store(4);
  load(1); pushint(8); pushint(8); b.push(0xba, 0x17); store(5);
  b.push(0x32, 6); load(4); load(3); b.push(ADD, GTE); const toCount = branch(0x41);
  b.push(0x32, 6); store(4); pushint(0); store(5);
  land(toCount);
  load(5); load(0); gtxns(18); b.push(ADD); store(5);
  load(5); load(2); b.push(LTE, ASSERT);
  load(1); pushint(0); load(4); b.push(0x16, 0xbb);
  load(1); pushint(8); load(5); b.push(0x16, 0xbb);
  pushint(1); b.push(0x43);
  land(toCreate);
  pushint(1); b.push(0x43);
  return new Uint8Array(b);
}

/** The counter box a mandate payment touches: sha256(payer || salt). */
export function counterBoxName(owner: string, salt: Uint8Array): Uint8Array {
  const pk = algosdk.decodeAddress(owner).publicKey;
  const input = new Uint8Array(pk.length + salt.length);
  input.set(pk);
  input.set(salt, pk.length);
  return sha256(input);
}

export function u64(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}

/**
 * Throws unless app `appId` on `algodUrl` runs exactly the counter for these terms.
 * The counter has no update or delete path, so matching code means matching behaviour forever.
 */
export async function verifyCounterApp(algodUrl: string, appId: number, terms: CounterTerms, fetchFn: typeof fetch = globalThis.fetch): Promise<void> {
  const res = await fetchFn(`${algodUrl.replace(/\/$/, "")}/v2/applications/${appId}`);
  if (!res.ok) throw new Error(`Spend counter app ${appId} not found on ${algodUrl}.`);
  const app: any = await res.json();
  const deployed = app?.params?.["approval-program"];
  const expected = toBase64(assembleCounter(terms));
  if (deployed !== expected) throw new Error(`App ${appId} is not the Moltworld spend counter for these terms. Do not sign.`);
}
