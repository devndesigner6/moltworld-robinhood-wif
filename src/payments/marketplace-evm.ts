import { recoverTypedDataAddress } from "viem";
import { config } from "../config.js";
import { canonicalJson } from "../receipts/index.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function creatorShareAtomic(grossAtomic: string, feePercent: number): string {
  if (!/^\d+$/.test(grossAtomic) || !Number.isInteger(feePercent) || feePercent < 0 || feePercent > 100) {
    throw new Error("Invalid gross atomic amount or marketplace fee.");
  }
  return ((BigInt(grossAtomic) * BigInt(100 - feePercent)) / 100n).toString();
}

/**
 * The marketplace has no verifying contract: listings are an off-chain control
 * message. The EIP-712 domain still binds signatures to Moltworld and the
 * configured Robinhood chain, while the nonce prevents cross-listing replay.
 */
export const MARKETPLACE_EIP712_TYPES = {
  Listing: [
    { name: "action", type: "string" },
    { name: "creator", type: "address" },
    { name: "slug", type: "string" },
    { name: "name", type: "string" },
    { name: "description", type: "string" },
    { name: "upstream_url", type: "string" },
    { name: "price_micro", type: "uint256" },
    { name: "input_example", type: "string" },
    { name: "nonce", type: "string" },
    { name: "issued_at", type: "uint64" },
  ],
} as const;

export interface EvmMarketplaceListing {
  action: "list";
  creator: string;
  slug: string;
  name: string;
  description: string;
  upstream_url: string;
  price_micro: number;
  input_example?: unknown;
  nonce: string;
  issued_at: number;
}

function chainId(): number {
  const raw = config.networkCaip2.split(":")[1];
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Marketplace network must use an EIP-155 chain id.");
  return value;
}

export function marketplaceEip712Domain() {
  return {
    name: "Moltworld Marketplace",
    version: "1",
    chainId: chainId(),
  } as const;
}

/** Exact typed data used by both creator clients and server-side verification. */
export function marketplaceListingTypedData(listing: EvmMarketplaceListing) {
  return {
    domain: marketplaceEip712Domain(),
    types: MARKETPLACE_EIP712_TYPES,
    primaryType: "Listing" as const,
    message: {
      action: listing.action,
      creator: listing.creator as `0x${string}`,
      slug: listing.slug,
      name: listing.name,
      description: listing.description,
      upstream_url: listing.upstream_url,
      price_micro: BigInt(listing.price_micro),
      input_example: canonicalJson(listing.input_example ?? null),
      nonce: listing.nonce,
      issued_at: BigInt(listing.issued_at),
    },
  } as const;
}

export async function verifyCreatorListingSignature(listing: EvmMarketplaceListing, signature: string): Promise<boolean> {
  if (!ADDRESS.test(listing.creator) || !/^0x[0-9a-fA-F]{130,}$/.test(signature)) return false;
  try {
    const recovered = await recoverTypedDataAddress({
      ...marketplaceListingTypedData(listing),
      signature: signature as `0x${string}`,
    });
    return recovered.toLowerCase() === listing.creator.toLowerCase();
  } catch {
    return false;
  }
}
