import algosdk from "algosdk";
import crypto from "crypto";

/**
 * The mandate spend counter: an immutable Algorand app that enforces a mandate's cap
 * per window on-chain. A capped mandate's program requires every payment to be
 * followed, in the same group, by a call to this app carrying the mandate's salt,
 * cap and window. The app adds the payment to that mandate's box and rejects the
 * group if the window's total would exceed the cap.
 *
 * - Immutable: only NoOp calls are approved, so there is no update or delete path.
 * - One box per mandate, keyed sha256(payer || salt): only payments from the owner's
 *   account (which its LogicSig authorizes) can move a mandate's counter.
 * - Only USDC payments to Moltworld of at least the price floor are counted, so
 *   creating junk counters costs real money paid to Moltworld.
 * - The window is fixed: it restarts at the first payment after the previous one ends.
 *
 * Boxes need minimum balance on the app account, which Moltworld funds.
 */

export interface CounterTerms {
  payTo: string;
  assetId: number;
  /** Smallest payment that is counted, in micro-USDC (the gateway's price floor). */
  minAmountMicro: number;
}

export const SPEND_SELECTOR = "spend";
/** Box name (32) + value (16): minimum balance the app account needs per mandate. */
export const COUNTER_BOX_MBR_MICROALGO = 2500 + 400 * (32 + 16);

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

/** TEAL source of the counter. Kept byte-for-byte equivalent to assembleCounter(). */
export function counterTeal(t: CounterTerms): string {
  const payTo = Buffer.from(algosdk.decodeAddress(t.payTo).publicKey).toString("hex");
  return [
    `#pragma version ${TEAL_VERSION}`,
    "// Moltworld mandate spend counter. Immutable: only NoOp calls; no update or delete.",
    "txn ApplicationID", "bz create",
    "txn OnCompletion", "pushint 0", "==", "assert",
    "txn NumAppArgs", "pushint 4", "==", "assert",
    "txna ApplicationArgs 0", `pushbytes 0x${Buffer.from(SPEND_SELECTOR).toString("hex")}`, "==", "assert",
    "// the payment being counted is the transaction just before this call, from the same account",
    "txn GroupIndex", "pushint 1", "-", "store 0",
    "load 0", "gtxns TypeEnum", "pushint 4", "==", "assert",
    "load 0", "gtxns Sender", "txn Sender", "==", "assert",
    "load 0", "gtxns XferAsset", `pushint ${t.assetId}`, "==", "assert",
    "load 0", "gtxns AssetReceiver", `pushbytes 0x${payTo}`, "==", "assert",
    "load 0", "gtxns AssetAmount", `pushint ${t.minAmountMicro}`, ">=", "assert",
    "// one box per mandate: sha256(payer || salt) -> window start (8) | spent (8)",
    "txn Sender", "txna ApplicationArgs 1", "concat", "sha256", "store 1",
    "txna ApplicationArgs 2", "btoi", "store 2",
    "txna ApplicationArgs 3", "btoi", "store 3",
    "load 1", "pushint 16", "box_create", "pop",
    "load 1", "pushint 0", "pushint 8", "box_extract", "btoi", "store 4",
    "load 1", "pushint 8", "pushint 8", "box_extract", "btoi", "store 5",
    "global Round", "load 4", "load 3", "+", ">=", "bz count",
    "global Round", "store 4", "pushint 0", "store 5",
    "count:",
    "load 5", "load 0", "gtxns AssetAmount", "+", "store 5",
    "load 5", "load 2", "<=", "assert",
    "load 1", "pushint 0", "load 4", "itob", "box_replace",
    "load 1", "pushint 8", "load 5", "itob", "box_replace",
    "pushint 1", "return",
    "create:",
    "pushint 1", "return",
    "",
  ].join("\n");
}

/** Assembles the counter locally, so clients can check the deployed app without an algod compiler. */
export function assembleCounter(t: CounterTerms): Uint8Array {
  const payTo = algosdk.decodeAddress(t.payTo).publicKey;
  const b: number[] = [TEAL_VERSION];
  const pushint = (v: number) => b.push(0x81, ...uvarint(v));
  const pushbytes = (x: Uint8Array) => b.push(0x80, ...uvarint(x.length), ...x);
  const txn = (f: number) => b.push(0x31, f);
  const gtxns = (f: number) => b.push(0x38, f);
  const store = (i: number) => b.push(0x35, i);
  const load = (i: number) => b.push(0x34, i);
  const [EQ, LTE, GTE, ASSERT, ADD, SUB] = [0x12, 0x0e, 0x0f, 0x44, 0x08, 0x09];
  // Branches are patched once their targets are known (2-byte offsets from the end of the branch).
  const branch = (op: number) => { b.push(op, 0, 0); return b.length; };
  const land = (from: number) => { const off = b.length - from; b[from - 2] = (off >> 8) & 0xff; b[from - 1] = off & 0xff; };

  txn(24); const toCreate = branch(0x41); // bz create
  txn(25); pushint(0); b.push(EQ, ASSERT);
  txn(27); pushint(4); b.push(EQ, ASSERT);
  b.push(0x36, 26, 0); pushbytes(new TextEncoder().encode(SPEND_SELECTOR)); b.push(EQ, ASSERT);
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
  b.push(0x32, 6); load(4); load(3); b.push(ADD, GTE); const toCount = branch(0x41); // bz count
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

/** Approves only ClearState, which never matters here: there is no local state. */
export function assembleCounterClear(): Uint8Array {
  return new Uint8Array([TEAL_VERSION, 0x81, 1]);
}

export const COUNTER_CLEAR_TEAL = `#pragma version ${TEAL_VERSION}\npushint 1\n`;

/** The counter box a mandate payment touches: sha256(payer || salt). */
export function counterBoxName(owner: string, salt: Uint8Array): Uint8Array {
  return new Uint8Array(crypto.createHash("sha256").update(algosdk.decodeAddress(owner).publicKey).update(salt).digest());
}

export function u64(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}
