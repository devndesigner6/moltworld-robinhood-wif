import algosdk from "algosdk";
import { config } from "../config.js";
import {
  claimDueRefunds,
  claimPendingPayouts,
  createPayoutsFromCredits,
  markPayouts,
  markRefundRetry,
  markRefundSent,
} from "../ledger/index.js";
import { sendUsdcGroup } from "../chain/algod.js";
import { usdToMicroCeil } from "../pricing/index.js";

/**
 * Moves money out of the payout hot wallet:
 *  - refunds for settled requests whose work failed (one transfer each);
 *  - usage rebates and creator earnings, rolled up per account once they pass a
 *    threshold, sent in atomic groups of up to 16 transfers.
 * Without PAYOUT_WALLET_MNEMONIC nothing is sent and everything stays pending
 * (visible at /v1/ops/*); nothing is ever reported as paid without a txid.
 */

export type Sender = (transfers: Array<{ to: string; amountMicro: number; note: string }>) => Promise<string>;

let sender: Sender | null = null;

export function payoutAccount(): algosdk.Account | null {
  if (!config.payoutMnemonic) return null;
  return algosdk.mnemonicToSecretKey(config.payoutMnemonic);
}

/** Tests inject a sender; production uses the payout wallet on algod. */
export function setPayoutSender(custom: Sender | null): void {
  sender = custom;
}

function resolveSender(): Sender | null {
  if (sender) return sender;
  const account = payoutAccount();
  if (!account) return null;
  return (transfers) => sendUsdcGroup(account, transfers);
}

export async function processRefunds(): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const send = resolveSender();
  if (!send) return { sent: 0, failed: 0, skipped: true };
  const refunds = await claimDueRefunds(10);
  let sent = 0;
  let failed = 0;
  for (const refund of refunds) {
    try {
      const txid = await send([{ to: refund.payer, amountMicro: refund.amount_micro, note: `moltworld-refund:${refund.request_id}` }]);
      await markRefundSent(refund, txid);
      sent++;
    } catch (err: any) {
      await markRefundRetry(refund, String(err?.message ?? err));
      failed++;
    }
  }
  return { sent, failed, skipped: false };
}

export async function processPayouts(): Promise<{ sent: number; failed: number; skipped: boolean }> {
  await createPayoutsFromCredits("rebate", usdToMicroCeil(config.rebateMinPayoutUsd));
  await createPayoutsFromCredits("creator", usdToMicroCeil(config.creatorPayoutMinUsd));
  const send = resolveSender();
  if (!send) return { sent: 0, failed: 0, skipped: true };

  const batch = await claimPendingPayouts(16);
  if (!batch.length) return { sent: 0, failed: 0, skipped: false };
  const ids = batch.map((p) => p.id);
  try {
    const txid = await send(batch.map((p) => ({ to: p.account, amountMicro: p.amount_micro, note: `moltworld-${p.kind}:${p.id}` })));
    await markPayouts(ids, "sent", txid);
    return { sent: batch.length, failed: 0, skipped: false };
  } catch (err: any) {
    // The group is atomic, so nothing was paid: return every payout to pending (or failed after retries).
    const giveUp = batch.filter((p) => p.attempts >= 8).map((p) => p.id);
    const retry = ids.filter((id) => !giveUp.includes(id));
    await markPayouts(retry, "pending", undefined, String(err?.message ?? err));
    await markPayouts(giveUp, "failed", undefined, String(err?.message ?? err));
    return { sent: 0, failed: batch.length, skipped: false };
  }
}
