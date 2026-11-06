import {
  PERMIT2_ADDRESS,
  type ClientEvmSigner,
  x402ExactPermit2ProxyAddress,
} from "@x402/evm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWifEvmMandateSigner } from "./evm-mandate.js";
import { WIF_MANDATE_ARTIFACT } from "./wif-mandate-artifact.js";

export const ROBINHOOD_WIF_MAINNET_TOKEN = getAddress("0x5173b8eA6923c2d40267890D45C46a3480954773");
const ROBINHOOD_MAINNET_CHAIN_ID = 4663;

export function isCanonicalWifMandateRuntime(code: Hex | undefined): boolean {
  if (!code || !/^0x[0-9a-f]+$/i.test(code)) return false;
  if (code.length !== WIF_MANDATE_ARTIFACT.deployedBytecode.length) return false;
  let normalized = code.slice(2).toLowerCase();
  for (const references of Object.values(WIF_MANDATE_ARTIFACT.immutableReferences)) {
    for (const { start, length } of references) {
      const begin = start * 2;
      const end = begin + length * 2;
      normalized = `${normalized.slice(0, begin)}${"0".repeat(length * 2)}${normalized.slice(end)}`;
    }
  }
  return `0x${normalized}` === WIF_MANDATE_ARTIFACT.runtimeTemplate;
}

export const wifMandateReadAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "permit2", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "exactProxy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "payTo", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "sessionAgent", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxPerCall", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expiry", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "active", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "remainingAllowance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sessionEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export interface EvmMandateReader {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
  }): Promise<unknown>;
}

export interface WifMandatePolicy {
  address: Address;
  owner: Address;
  token: Address;
  permit2: Address;
  exactProxy: Address;
  payTo: Address;
  sessionAgent: Address;
  maxPerCall: bigint;
  expiry: bigint;
  sessionEpoch: bigint;
  active: true;
  remainingAllowance: bigint;
  tokenBalance: bigint;
}

export async function readWifMandatePolicy(
  publicClient: EvmMandateReader,
  mandateAddress: Address | string,
  sessionPrivateKey: Hex | string,
  expectedOwner: Address | string,
  expectedPayTo: Address | string,
): Promise<WifMandatePolicy> {
  const address = getAddress(mandateAddress);
  const trustedOwner = getAddress(expectedOwner);
  const trustedPayTo = getAddress(expectedPayTo);
  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    throw new Error(`WIF mandate is mainnet-only; RPC returned chain ID ${actualChainId}.`);
  }
  const code = await publicClient.getCode({ address });
  if (!isCanonicalWifMandateRuntime(code)) {
    throw new Error("WIF mandate runtime code does not match the pinned Moltworld contract artifact.");
  }

  const read = (functionName: string) => publicClient.readContract({ address, abi: wifMandateReadAbi, functionName });
  const [ownerRaw, tokenRaw, permit2Raw, exactProxyRaw, payToRaw, agentRaw, maxPerCallRaw, expiryRaw, activeRaw, allowanceRaw, tokenBalanceRaw, sessionEpochRaw] =
    await Promise.all([
      read("owner"),
      read("token"),
      read("permit2"),
      read("exactProxy"),
      read("payTo"),
      read("sessionAgent"),
      read("maxPerCall"),
      read("expiry"),
      read("active"),
      read("remainingAllowance"),
      read("tokenBalance"),
      read("sessionEpoch"),
    ]);

  const owner = getAddress(String(ownerRaw));
  const token = getAddress(String(tokenRaw));
  const permit2 = getAddress(String(permit2Raw));
  const exactProxy = getAddress(String(exactProxyRaw));
  const payTo = getAddress(String(payToRaw));
  const sessionAgent = getAddress(String(agentRaw));
  const maxPerCall = BigInt(String(maxPerCallRaw));
  const expiry = BigInt(String(expiryRaw));
  const remainingAllowance = BigInt(String(allowanceRaw));
  const tokenBalance = BigInt(String(tokenBalanceRaw));
  const sessionEpoch = BigInt(String(sessionEpochRaw));
  const expectedAgent = getAddress(privateKeyToAccount(sessionPrivateKey as Hex).address);

  if (owner !== trustedOwner) throw new Error("Mandate owner does not match the configured owner wallet.");
  if (token !== ROBINHOOD_WIF_MAINNET_TOKEN) throw new Error("Mandate token is not the canonical Robinhood WIF contract.");
  if (permit2 !== getAddress(PERMIT2_ADDRESS)) throw new Error("Mandate does not use the canonical Permit2 contract.");
  if (exactProxy !== getAddress(x402ExactPermit2ProxyAddress)) throw new Error("Mandate does not use x402's exact Permit2 proxy.");
  if (payTo !== trustedPayTo) throw new Error("Mandate recipient does not match the trusted gateway pay-to address.");
  const [permit2Code, proxyCode] = await Promise.all([
    publicClient.getCode({ address: permit2 }),
    publicClient.getCode({ address: exactProxy }),
  ]);
  if (!permit2Code || permit2Code === "0x") throw new Error("Canonical Permit2 has no deployed code on this network.");
  if (!proxyCode || proxyCode === "0x") throw new Error("x402 exact Permit2 proxy has no deployed code on this network.");
  if (sessionAgent !== expectedAgent) throw new Error("Local session key does not match the mandate's authorized agent address.");
  if (activeRaw !== true) throw new Error("WIF mandate is not active or has been revoked.");
  if (maxPerCall <= 0n) throw new Error("WIF mandate has no positive per-call cap.");
  if (expiry <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("WIF mandate has expired.");
  if (remainingAllowance <= 0n) throw new Error("WIF mandate has no remaining Permit2 allowance.");
  if (remainingAllowance > tokenBalance) throw new Error("WIF mandate balance is below its remaining Permit2 allowance.");
  if (remainingAllowance === (1n << 256n) - 1n) throw new Error("WIF mandate allowance is unlimited; refusing to sign.");
  if (sessionEpoch <= 0n) throw new Error("WIF mandate session epoch is invalid.");

  return {
    address,
    owner,
    token,
    permit2,
    exactProxy,
    payTo,
    sessionAgent,
    maxPerCall,
    expiry,
    sessionEpoch,
    active: true,
    remainingAllowance,
    tokenBalance,
  };
}

export function createWifMandateClientSigner(options: {
  publicClient: EvmMandateReader;
  mandateAddress: Address | string;
  sessionPrivateKey: Hex | string;
  expectedOwner: Address | string;
  expectedPayTo: Address | string;
}): ClientEvmSigner {
  const address = getAddress(options.mandateAddress);
  const sessionPrivateKey = options.sessionPrivateKey as Hex;

  return {
    address,
    async signTypedData(request) {
      const policy = await readWifMandatePolicy(options.publicClient, address, sessionPrivateKey, options.expectedOwner, options.expectedPayTo);
      const signer = createWifEvmMandateSigner({
        sessionPrivateKey,
        vaultAddress: address,
        expectedChainId: ROBINHOOD_MAINNET_CHAIN_ID,
        expectedWifToken: policy.token,
        expectedPayTo: options.expectedPayTo,
        expectedPermit2Proxy: policy.exactProxy,
        maxPerCallAmount: policy.maxPerCall,
        sessionEpoch: policy.sessionEpoch,
        expiryTimestamp: policy.expiry,
      });
      return signer.signTypedData(request);
    },
  };
}
