import algosdk from "algosdk";
import { config } from "../config.js";

/** Minimal algod access for balance checks and the gateway's own payout transactions. */

function headers(): Record<string, string> {
  return config.algodToken ? { "X-Algo-API-Token": config.algodToken } : {};
}

let client: algosdk.Algodv2 | null = null;

export function algodClient(): algosdk.Algodv2 {
  if (!client) {
    const url = new URL(config.algodUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    client = new algosdk.Algodv2(config.algodToken, `${url.protocol}//${url.hostname}`, port);
  }
  return client;
}

/** USDC (micro units) an account holds, or null when unknown. */
export async function usdcBalanceMicro(address: string): Promise<number | null> {
  try {
    const res = await fetch(`${config.algodUrl}/v2/accounts/${address}/assets/${config.usdcAsaId}`, {
      headers: headers(),
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return 0; // not opted in
    if (!res.ok) return null;
    const data: any = await res.json();
    return Number(data?.["asset-holding"]?.amount ?? 0);
  } catch {
    return null;
  }
}

/** Last committed round, used to check mandate expiry. */
export async function currentRound(): Promise<number | null> {
  try {
    const res = await fetch(`${config.algodUrl}/v2/status`, { headers: headers(), signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    return Number(data["last-round"]);
  } catch {
    return null;
  }
}

/**
 * Send a group of USDC transfers from the payout wallet in one atomic group
 * (all succeed or none do). Returns the first transaction id.
 */
export async function sendUsdcGroup(
  sender: algosdk.Account,
  transfers: Array<{ to: string; amountMicro: number; note: string }>
): Promise<string> {
  if (transfers.length === 0 || transfers.length > 16) throw new Error("A group holds between 1 and 16 transfers.");
  const algod = algodClient();
  const sp = await algod.getTransactionParams().do();
  const txns = transfers.map((t) =>
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: sender.addr,
      receiver: t.to,
      assetIndex: Number(config.usdcAsaId),
      amount: t.amountMicro,
      suggestedParams: sp,
      note: new TextEncoder().encode(t.note),
    })
  );
  if (txns.length > 1) algosdk.assignGroupID(txns);
  const signed = txns.map((t) => t.signTxn(sender.sk));
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 8);
  return txid;
}
