import {
  PERMIT2_ADDRESS,
  type ClientEvmSigner,
  x402ExactPermit2ProxyAddress,
} from "@x402/evm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWifEvmMandateSigner } from "./evm-mandate.js";

export const ROBINHOOD_WIF_MAINNET_TOKEN = getAddress("0x5173b8eA6923c2d40267890D45C46a3480954773");
const ROBINHOOD_MAINNET_CHAIN_ID = 4663;

export const wifMandateReadAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "permit2", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "exactProxy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "payTo", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "sessionAgent", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxPerCall", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expiry", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "active", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "remainingAllowance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
  token: Address;
  permit2: Address;
  exactProxy: Address;
  payTo: Address;
  sessionAgent: Address;
  maxPerCall: bigint;
  expiry: bigint;
  active: true;
  remainingAllowance: bigint;
}

export async function readWifMandatePolicy(
  publicClient: EvmMandateReader,
  mandateAddress: Address | string,
  sessionPrivateKey: Hex | string,
): Promise<WifMandatePolicy> {
  const address = getAddress(mandateAddress);
  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    throw new Error(`WIF mandate is mainnet-only; RPC returned chain ID ${actualChainId}.`);
  }
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error("WIF mandate address has no deployed contract code.");

  const read = (functionName: string) => publicClient.readContract({ address, abi: wifMandateReadAbi, functionName });
  const [tokenRaw, permit2Raw, exactProxyRaw, payToRaw, agentRaw, maxPerCallRaw, expiryRaw, activeRaw, allowanceRaw] =
    await Promise.all([
      read("token"),
      read("permit2"),
      read("exactProxy"),
      read("payTo"),
      read("sessionAgent"),
      read("maxPerCall"),
      read("expiry"),
      read("active"),
      read("remainingAllowance"),
    ]);

  const token = getAddress(String(tokenRaw));
  const permit2 = getAddress(String(permit2Raw));
  const exactProxy = getAddress(String(exactProxyRaw));
  const payTo = getAddress(String(payToRaw));
  const sessionAgent = getAddress(String(agentRaw));
  const maxPerCall = BigInt(String(maxPerCallRaw));
  const expiry = BigInt(String(expiryRaw));
  const remainingAllowance = BigInt(String(allowanceRaw));
  const expectedAgent = getAddress(privateKeyToAccount(sessionPrivateKey as Hex).address);

  if (token !== ROBINHOOD_WIF_MAINNET_TOKEN) throw new Error("Mandate token is not the canonical Robinhood WIF contract.");
  if (permit2 !== getAddress(PERMIT2_ADDRESS)) throw new Error("Mandate does not use the canonical Permit2 contract.");
  if (exactProxy !== getAddress(x402ExactPermit2ProxyAddress)) throw new Error("Mandate does not use x402's exact Permit2 proxy.");
  if (sessionAgent !== expectedAgent) throw new Error("Local session key does not match the mandate's authorized agent address.");
  if (activeRaw !== true) throw new Error("WIF mandate is not active or has been revoked.");
  if (maxPerCall <= 0n) throw new Error("WIF mandate has no positive per-call cap.");
  if (expiry <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("WIF mandate has expired.");
  if (remainingAllowance <= 0n) throw new Error("WIF mandate has no remaining Permit2 allowance.");

  return {
    address,
    token,
    permit2,
    exactProxy,
    payTo,
    sessionAgent,
    maxPerCall,
    expiry,
    active: true,
    remainingAllowance,
  };
}

export function createWifMandateClientSigner(options: {
  publicClient: EvmMandateReader;
  mandateAddress: Address | string;
  sessionPrivateKey: Hex | string;
}): ClientEvmSigner {
  const address = getAddress(options.mandateAddress);
  const sessionPrivateKey = options.sessionPrivateKey as Hex;

  return {
    address,
    async signTypedData(request) {
      const policy = await readWifMandatePolicy(options.publicClient, address, sessionPrivateKey);
      const signer = createWifEvmMandateSigner({
        sessionPrivateKey,
        vaultAddress: address,
        expectedChainId: ROBINHOOD_MAINNET_CHAIN_ID,
        expectedWifToken: policy.token,
        expectedPayTo: policy.payTo,
        expectedPermit2Proxy: policy.exactProxy,
        maxPerCallAmount: policy.maxPerCall,
        expiryTimestamp: policy.expiry,
      });
      return signer.signTypedData(request);
    },
  };
}
