# moltworld-sdk

x402 client for Moltworld's pay-per-request AI gateway. The migration adds Robinhood Chain WIF payments through an EVM signer while preserving the old AVM signer path for legacy Algorand deployments. The Robinhood deployment currently accepts chat calls only.

## Robinhood Chain / MetaMask

Use a wallet client backed by an EIP-1193 provider, such as MetaMask or Robinhood Wallet. The caller should configure the wallet on Robinhood Chain mainnet (chain ID `4663`) and use the gateway's public WIF contract and receiving address from `/health`.

```ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { toClientEvmSigner } from "@x402/evm";
import { MoltworldClient } from "moltworld-sdk";

const provider = window.ethereum;
const [address] = await provider.request({ method: "eth_requestAccounts" });
const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
};
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account: address, chain, transport: custom(provider) });
const evmSigner = toClientEvmSigner({
  address,
  signTypedData: (data) => walletClient.signTypedData({ ...data, account: address }),
}, publicClient);

const client = new MoltworldClient({
  baseUrl: "https://moltworld.xyz",
  evmSigner,
  maxPerRequestUsd: 0.25,
  budgetUsd: 5,
});
const result = await client.chat("gpt-4o", {
  messages: [{ role: "user", content: "Hi" }],
  max_tokens: 300,
});
console.log(result.data.choices[0].message.content);
console.log(result.receipt?.amountAtomic, result.receipt?.assetSymbol); // exact WIF base units
console.log(result.verification?.ok); // signed receipt + request/response hashes checked
```

For tokens without a usable Permit2 allowance, clients must arrange a WIF approval to the Permit2 contract before x402 payment creation. The Playground requests an exact allowance, not an unlimited one; that separate approval transaction requires a small amount of native ETH for gas. The x402 request itself is denominated in WIF. Never pass a wallet private key or seed phrase to Moltworld.

`paidMicro` in SDK results remains the USD quote value for spend-budget accounting; `receipt.amountAtomic` is the exact ERC-20 amount in base units and must not be converted through JavaScript `Number`.

## Legacy Algorand signer

Algorand-specific helpers (`mnemonic`, `privateKeyBase64`, AVM signers, and spending mandates) remain for legacy deployments only. The Robinhood WIF gateway disables mandate endpoints and does not accept AVM payment payloads. No Algorand LogicSig or application ID can be reused on Robinhood Chain.

The Python client has not yet been ported to EVM; do not advertise it as a Robinhood WIF payer until that work is complete.
