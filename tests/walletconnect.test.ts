import { afterEach, describe, expect, it } from "vitest";
import { createWallets, type PayConfig } from "../web/pay.js";

const baseConfig = (reownProjectId?: string): PayConfig => ({
  origin: "https://example.test",
  network: "mainnet",
  paymentChain: "robinhood",
  chainId: 4663,
  reownProjectId,
  paymentAssetAddress: "0x5173b8eA6923c2d40267890D45C46a3480954773",
  paymentAssetSymbol: "WIF",
  paymentAssetDecimals: 18,
  robinhoodRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  usdcAssetId: 0,
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe("Robinhood browser wallet connectivity", () => {
  it("fails closed to no external option when there is no injected provider or project ID", async () => {
    (globalThis as any).window = {};

    const wallets = await createWallets(baseConfig());

    expect(wallets.options).toEqual([]);
  });

  it("offers WalletConnect only when a public project ID is configured", async () => {
    (globalThis as any).window = {};

    const wallets = await createWallets(baseConfig("configured-public-id"));

    expect(wallets.options).toEqual([{ id: "walletconnect", name: "WalletConnect (mobile wallets)", icon: "" }]);
  });

  it("keeps injected EIP-1193 connection without WalletConnect or signing during connect", async () => {
    const requests: string[] = [];
    const provider = {
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x1237";
        throw new Error(`Unexpected request ${method}`);
      },
      on: () => undefined,
    };
    (globalThis as any).window = { ethereum: provider };

    const wallets = await createWallets(baseConfig());
    await wallets.connect("injected");

    expect(wallets.address).toBe("0x1111111111111111111111111111111111111111");
    expect(requests).toEqual(["eth_requestAccounts", "eth_chainId"]);
    expect(requests.some((method) => /sign|send|approve/i.test(method))).toBe(false);
  });

  it("selects MetaMask from multiple injected providers and shows its local logo", async () => {
    const otherRequests: string[] = [];
    const metaMaskRequests: string[] = [];
    const other = {
      request: async ({ method }: { method: string }) => { otherRequests.push(method); return []; },
      on: () => undefined,
    };
    const metaMask = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        metaMaskRequests.push(method);
        if (method === "eth_requestAccounts") return ["0x2222222222222222222222222222222222222222"];
        if (method === "eth_chainId") return "0x1237";
        throw new Error(`Unexpected request ${method}`);
      },
      on: () => undefined,
    };
    (globalThis as any).window = {
      ethereum: { request: async () => [], providers: [other, metaMask] },
    };

    const wallets = await createWallets(baseConfig());

    expect(wallets.options).toEqual([{
      id: "injected",
      name: "MetaMask",
      icon: "/assets/wallets/metamask.png",
    }]);
    await wallets.connect("injected");
    expect(wallets.address).toBe("0x2222222222222222222222222222222222222222");
    expect(metaMaskRequests).toEqual(["eth_requestAccounts", "eth_chainId"]);
    expect(otherRequests).toEqual([]);
  });
});
