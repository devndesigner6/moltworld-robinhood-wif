import type { WifPriceSnapshot } from "../pricing/wif.js";

/** The x402 Permit2 authorization itself remains bounded to 120 seconds. */
export const WIF_CHAT_MAX_TIMEOUT_SECONDS = 120;

/** Keep server-issued quote terms available while a user reviews the wallet request. */
export const WIF_QUOTE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_WIF_CHALLENGES = 5_000;

export interface WifQuoteChallenge {
  quoteId: string;
  route: string;
  requestSha256: string;
  amountMicro: number;
  amountAtomic: string;
  wifPrice: WifPriceSnapshot;
  expiresAt: number;
}

export interface WifQuoteChallengeTerms {
  network: string;
  asset: string;
  payTo: string;
  symbol: string;
  decimals: number;
  maxTimeoutSeconds: number;
}

const pending = new Map<string, WifQuoteChallenge>();

function pruneExpired(now: number): void {
  for (const [quoteId, challenge] of pending) {
    if (challenge.expiresAt <= now) pending.delete(quoteId);
  }
}

/** Stores only the original server-calculated WIF amount and price snapshot, never a signature or wallet key. */
export function rememberWifQuoteChallenge(
  input: Omit<WifQuoteChallenge, "expiresAt">,
  now = Date.now(),
): void {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(input.quoteId)) throw new Error("Invalid WIF quote challenge ID.");
  if (!input.route.startsWith("/")) throw new Error("Invalid WIF quote challenge route.");
  if (!/^[0-9a-f]{64}$/.test(input.requestSha256)) throw new Error("Invalid WIF quote request hash.");
  if (!Number.isSafeInteger(input.amountMicro) || input.amountMicro <= 0) throw new Error("Invalid WIF quote USD amount.");
  if (!/^[1-9][0-9]*$/.test(input.amountAtomic)) throw new Error("Invalid WIF quote atomic amount.");
  if (!/^[1-9][0-9]*$/.test(input.wifPrice.effectivePriceUsdScaled18)) throw new Error("Invalid WIF quote price snapshot.");

  pruneExpired(now);
  pending.delete(input.quoteId);
  pending.set(input.quoteId, {
    ...input,
    wifPrice: { ...input.wifPrice },
    expiresAt: now + WIF_QUOTE_CHALLENGE_TTL_MS,
  });
  while (pending.size > MAX_PENDING_WIF_CHALLENGES) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** Returns the original snapshot only for the same server challenge, route, and byte-identical request body. */
export function getWifQuoteChallenge(
  quoteId: string,
  route: string,
  requestSha256: string,
  now = Date.now(),
): WifQuoteChallenge | undefined {
  pruneExpired(now);
  const challenge = pending.get(quoteId);
  if (!challenge || challenge.route !== route || challenge.requestSha256 !== requestSha256) return undefined;
  return { ...challenge, wifPrice: { ...challenge.wifPrice } };
}

/** Checks that the signed v2 accepted requirement is exactly the server-issued WIF quote. */
export function matchesWifQuoteRequirement(
  accepted: unknown,
  challenge: WifQuoteChallenge,
  expected: WifQuoteChallengeTerms,
): boolean {
  if (!accepted || typeof accepted !== "object") return false;
  const requirement = accepted as Record<string, any>;
  const extra = requirement.extra;
  if (!extra || typeof extra !== "object") return false;
  const sameAddress = (left: unknown, right: string) =>
    typeof left === "string" && left.toLowerCase() === right.toLowerCase();

  return requirement.scheme === "exact"
    && requirement.network === expected.network
    && String(requirement.amount) === challenge.amountAtomic
    && sameAddress(requirement.asset, expected.asset)
    && sameAddress(requirement.payTo, expected.payTo)
    && Number(requirement.maxTimeoutSeconds) === expected.maxTimeoutSeconds
    && extra.quoteId === challenge.quoteId
    && extra.tag === "x402-global-challenge"
    && extra.assetTransferMethod === "permit2"
    && extra.symbol === expected.symbol
    && Number(extra.decimals) === expected.decimals
    && Number(extra.quotedUsdMicro) === challenge.amountMicro
    && String(extra.wifPriceUsdScaled18) === challenge.wifPrice.effectivePriceUsdScaled18
    && String(extra.wifSpotPriceUsd) === challenge.wifPrice.priceUsd;
}

/** Test isolation only; production code never needs to clear an active quote. */
export function clearWifQuoteChallengesForTests(): void {
  pending.clear();
}
