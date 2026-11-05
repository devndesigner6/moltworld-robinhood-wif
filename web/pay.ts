// Browser payments for the Playground: legacy Algorand wallet/mandate support plus
// Robinhood Chain WIF payments through an injected MetaMask or Robinhood Wallet provider.
// Bundled by `pnpm vendor`.
import algosdk from "algosdk";
import { custom, NetworkConfigBuilder, NetworkId, WalletManager, type WalletAdapterConfig } from "@txnlab/use-wallet";
import { createPublicClient, createWalletClient, custom as evmCustom, defineChain, http, type Address } from "viem";
import { PERMIT2_ADDRESS, toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import { agentKeyFromSecret, createMandateSigner, fromBase64, fromUtf8, generateAgentKey, mandateAgent, MoltworldClient, type AvmSigner, type MandateCredential } from "../sdk/js/src/index.js";

export { agentKeyFromSecret, generateAgentKey, mandateAgent };

export interface PayConfig {
  origin: string;
  network: "mainnet" | "testnet";
  paymentChain?: "algorand" | "robinhood";
  chainId?: number;
  paymentAssetAddress?: string;
  paymentAssetSymbol?: string;
  paymentAssetDecimals?: number;
  robinhoodRpcUrl?: string;
  usdcAssetId: number;
  /** Algod for building payments; the SDK's public default is used when absent. */
  algodUrl?: string;
  /** Base64 secret key of a funded local-ledger account. Only ever set by the offline stack. */
  devWalletKey?: string;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
}

export interface Wallets {
  options: WalletOption[];
  readonly address: string | null;
  connect(id: string): Promise<string>;
  disconnect(): Promise<void>;
  signer(): AvmSigner | ClientEvmSigner;
  usdcBalanceMicro(): Promise<number | null>;
  paymentBalanceAtomic(): Promise<string | null>;
  ensureEvmAllowance?(asset: string, amount: string, onStatus?: (message: string) => void): Promise<void>;
  onChange(listener: () => void): () => void;
}

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
};

declare global {
  interface Window { ethereum?: Eip1193Provider }
}

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "approved", type: "bool" }] },
] as const;

function robinhoodChain(cfg: PayConfig) {
  const chainId = cfg.chainId || (cfg.network === "mainnet" ? 4663 : 46630);
  const rpcUrl = cfg.robinhoodRpcUrl || (cfg.network === "mainnet" ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");
  const explorer = cfg.network === "mainnet" ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com";
  return defineChain({
    id: chainId,
    name: cfg.network === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: explorer } },
  });
}

async function createEvmWallets(cfg: PayConfig): Promise<Wallets> {
  const provider = window.ethereum;
  const chain = robinhoodChain(cfg);
  const token = cfg.paymentAssetAddress as Address;
  const publicClient = createPublicClient({ chain, transport: http(cfg.robinhoodRpcUrl) });
  let address: Address | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const accountsChanged = (accounts: string[]) => { address = (accounts?.[0] as Address | undefined) ?? null; notify(); };
  const chainChanged = () => { notify(); };
  provider?.on?.("accountsChanged", accountsChanged);
  provider?.on?.("chainChanged", chainChanged);

  async function requireChain() {
    if (!provider) throw new Error("Install MetaMask or Robinhood Wallet to connect an EVM account.");
    const target = `0x${chain.id.toString(16)}`;
    const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (current === target.toLowerCase()) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] });
    } catch (err: any) {
      if (err?.code !== 4902) throw err;
      await provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: target,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : undefined,
      }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] });
    }
  }

  function walletClient() {
    if (!provider || !address) throw new Error("Connect an EVM wallet first.");
    return createWalletClient({ account: address, chain, transport: evmCustom(provider as any) });
  }

  return {
    options: provider ? [{ id: "injected", name: "MetaMask / Robinhood Wallet", icon: "" }] : [],
    get address() { return address; },
    async connect(id) {
      if (id !== "injected" || !provider) throw new Error("No compatible EVM wallet was found.");
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("The wallet returned no accounts.");
      await requireChain();
      address = accounts[0] as Address;
      notify();
      return address;
    },
    async disconnect() { address = null; notify(); },
    signer() {
      if (!address) throw new Error("Connect an EVM wallet first.");
      const wallet = walletClient();
      return toClientEvmSigner({
        address,
        signTypedData: async ({ domain, types, primaryType, message }) => wallet.signTypedData({
          account: address!,
          domain: domain as any,
          types: types as any,
          primaryType: primaryType as any,
          message: message as any,
        }),
      }, publicClient as any);
    },
    async usdcBalanceMicro() { return null; },
    async paymentBalanceAtomic() {
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(String(token))) return null;
      try {
        const balance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [address] });
        return balance.toString();
      } catch { return null; }
    },
    async ensureEvmAllowance(asset, amount, onStatus) {
      if (!address || !provider) throw new Error("Connect an EVM wallet first.");
      if (asset.toLowerCase() !== String(token).toLowerCase()) throw new Error("Refusing approval for a token other than WIF.");
      const required = BigInt(amount);
      const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [address, PERMIT2_ADDRESS] });
      if (allowance >= required) return;
      onStatus?.("Approve the exact WIF allowance to Permit2; this one-time approval uses Robinhood Chain ETH for gas.");
      const wallet = walletClient();
      const hash = await wallet.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [PERMIT2_ADDRESS, required] });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Accepts the MOLTWORLD_MANDATE value (base64 JSON) or the raw JSON credential. */
export function parseMandate(text: string): MandateCredential {
  const raw = text.trim();
  const json = raw.startsWith("{") ? raw : fromUtf8(fromBase64(raw));
  const value = JSON.parse(json);
  if (!value || typeof value.owner !== "string" || typeof value.programB64 !== "string" || typeof value.delegationSigB64 !== "string") {
    throw new Error("Not a mandate credential: expected owner, programB64 and delegationSigB64.");
  }
  return value;
}

/** The mandate's id: the address of its program. */
export function mandateId(credential: MandateCredential): string {
  return new algosdk.LogicSigAccount(fromBase64(credential.programB64)).address().toString();
}

/** Throws unless the credential's delegation matches its owner and the agent key is the one it's bound to. */
export function checkMandate(credential: MandateCredential, agentSecretKeyB64?: string): string {
  return createMandateSigner(credential, agentSecretKeyB64).address;
}

function devWallet(secretKeyB64: string): WalletAdapterConfig {
  const sk = fromBase64(secretKeyB64);
  const address = new algosdk.Address(sk.slice(32)).toString();
  const accounts = [{ name: "Local dev wallet", address }];
  return custom({
    metadata: { name: "Local dev wallet", icon: "" },
    provider: {
      connect: async () => accounts,
      resumeSession: async () => accounts,
      disconnect: async () => {},
      async signTransactions(txnGroup, indexesToSign) {
        const group = (txnGroup as Array<Uint8Array | algosdk.Transaction>).flat() as Array<Uint8Array | algosdk.Transaction>;
        return group.map((t, i) => {
          if (indexesToSign && !indexesToSign.includes(i)) return null;
          const txn = t instanceof Uint8Array ? algosdk.decodeUnsignedTransaction(t) : t;
          return txn.sender.toString() === address ? txn.signTxn(sk) : null;
        });
      },
    },
  });
}

export async function createWallets(cfg: PayConfig): Promise<Wallets> {
  if (cfg.paymentChain === "robinhood") return createEvmWallets(cfg);
  const adapters: WalletAdapterConfig[] = [];
  if (cfg.devWalletKey) adapters.push(devWallet(cfg.devWalletKey));
  const [{ pera }, { defly }, { lute }, { kibisis }] = await Promise.all([
    import("@txnlab/use-wallet-pera"),
    import("@txnlab/use-wallet-defly"),
    import("@txnlab/use-wallet-lute"),
    import("@txnlab/use-wallet-kibisis"),
  ]);
  adapters.push(pera(), defly(), lute({ siteName: "Moltworld" }), kibisis());

  const networkId = cfg.network === "mainnet" ? NetworkId.MAINNET : NetworkId.TESTNET;
  const builder = new NetworkConfigBuilder();
  if (cfg.algodUrl) {
    // use-wallet merges in a default port, so pass the URL's own port explicitly.
    const url = new URL(cfg.algodUrl);
    const algod = { token: "", baseServer: `${url.protocol}//${url.hostname}`, port: url.port || (url.protocol === "https:" ? "443" : "80") };
    if (networkId === NetworkId.MAINNET) builder.mainnet({ algod });
    else builder.testnet({ algod });
  }
  const manager = new WalletManager({ wallets: adapters, networks: builder.build(), defaultNetwork: networkId });
  await manager.resumeSessions().catch(() => {});

  const listeners = new Set<() => void>();
  manager.subscribe(() => listeners.forEach((l) => l()));

  return {
    options: manager.wallets.map((w) => ({ id: w.walletKey, name: w.metadata.name, icon: w.metadata.icon })),
    get address() {
      return manager.activeAddress;
    },
    async connect(id) {
      const wallet = manager.getWallet(id as any);
      if (!wallet) throw new Error(`Unknown wallet ${id}.`);
      const accounts = await wallet.connect();
      wallet.setActive();
      if (!accounts.length) throw new Error("The wallet returned no accounts.");
      return manager.activeAddress ?? accounts[0].address;
    },
    async disconnect() {
      await manager.activeWallet?.disconnect();
    },
    signer() {
      const address = manager.activeAddress;
      if (!address) throw new Error("Connect a wallet first.");
      return { address, signTransactions: (txns, indexesToSign) => manager.signTransactions(txns, indexesToSign) };
    },
    async usdcBalanceMicro() {
      const address = manager.activeAddress;
      if (!address) return null;
      try {
        const info = await manager.algodClient.accountAssetInformation(address, cfg.usdcAssetId).do();
        return Number(info.assetHolding?.amount ?? 0);
      } catch {
        return null; // Not opted in to USDC, or the node is unreachable.
      }
    },
    async paymentBalanceAtomic() {
      const address = manager.activeAddress;
      if (!address) return null;
      try {
        const info = await manager.algodClient.accountAssetInformation(address, cfg.usdcAssetId).do();
        return String(info.assetHolding?.amount ?? 0);
      } catch { return null; }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createClient(
  cfg: PayConfig,
  payer: {
    signer?: AvmSigner;
    evmSigner?: ClientEvmSigner;
    ensureEvmAllowance?: (payment: { asset: string; amount: string; network: string }) => Promise<void>;
    mandate?: MandateCredential;
    agentKey?: string;
  },
  maxPerRequestUsd: number
): MoltworldClient {
  return new MoltworldClient({ baseUrl: cfg.origin, ...payer, maxPerRequestUsd, algodUrl: cfg.algodUrl });
}
