import type { Context } from "hono";
import type { ModelDefinition } from "../models/registry.js";
import type { ListingRecord } from "../ledger/index.js";
import type { PriceQuote, ValidatedRequest } from "../pricing/index.js";
import type { ChatCompletionUsage } from "../providers/types.js";
import type { WifPriceSnapshot } from "../pricing/wif.js";

/**
 * Everything the gateway knows about one paid request, carried on the Hono
 * context from pre-payment validation, through the x402 hooks, to finalization.
 * Payer and txid come only from the facilitator's verify/settle results, never
 * from client-supplied headers.
 */
export interface PaymentState {
  requestId: string;
  kind: "model" | "market";
  resource: string;
  model?: ModelDefinition;
  listing?: ListingRecord;
  request?: ValidatedRequest;
  rawBody: Uint8Array;
  requestSha256: string;
  quote?: PriceQuote;
  /** USD micro-dollars retained for model cost accounting. */
  amountMicro: number;
  /** Exact ERC-20 base-unit amount requested by x402; never convert through JS Number. */
  amountAtomic: string;
  wifPrice?: WifPriceSnapshot;
  /** Server-issued WIF quote ID echoed inside the signed x402 accepted requirement. */
  quoteId?: string;
  paymentFlow: "authorization" | "upfront";
  paymentHash?: string;
  payer?: string;
  mandateId?: string;
  recorded?: boolean;
  reservedMicro?: number;
  settlement?: { txid: string; phase: string };
  upstream?: {
    provider: string;
    model: string;
    costUsd?: number;
    usage?: ChatCompletionUsage;
  };
  /** Why a payment was refused by a guard, surfaced in the 402 body. */
  rejection?: { reason: string; message: string };
  /** Set by the video handler: the request is settled and its job is running. */
  jobId?: string;
}

const KEY = "moltworldPayment";

export function getPaymentState(c: Context): PaymentState | undefined {
  return c.get(KEY as never) as PaymentState | undefined;
}

export function setPaymentState(c: Context, state: PaymentState): void {
  c.set(KEY as never, state as never);
}

/** x402 hooks receive the HTTP transport context; the Hono adapter holds the request context. */
export function contextFromTransport(transportContext: unknown): Context | undefined {
  const adapter = (transportContext as any)?.request?.adapter;
  return adapter?.c as Context | undefined;
}

export function stateFromTransport(transportContext: unknown): PaymentState | undefined {
  const c = contextFromTransport(transportContext);
  return c ? getPaymentState(c) : undefined;
}
