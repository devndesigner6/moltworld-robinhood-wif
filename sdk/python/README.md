# moltworld (Python)

The SDK supports the existing Algorand USDC x402 flow and WIF payments on Robinhood Chain. The default API origin is `https://motoworld-wif.vercel.app`.

## Algorand

```python
from moltworld import MoltworldClient

client = MoltworldClient(mnemonic="...", max_per_request_usd=0.25, budget_usd=5)
print(client.quote("gpt-4o", {"messages": [{"role": "user", "content": "Hi"}], "max_tokens": 300}))
result = client.chat("gpt-4o", [{"role": "user", "content": "Hi"}], max_tokens=300)
print(result.data["choices"][0]["message"]["content"], result.verified, result.receipt["txid"])
```

## WIF on Robinhood Chain

Install the package normally; it pins the official x402 Python SDK 2.27.0 with its EVM and requests extras:

```python
from moltworld import MoltworldClient

client = MoltworldClient(
    evm_private_key="0x...",
    max_per_request_usd=0.25,
    budget_usd=5,
)
result = client.chat("gpt-4o", [{"role": "user", "content": "Hi"}])
assert result.paid_micro == result.receipt["quotedUsdMicro"]
assert result.paid_atomic == result.receipt["amountAtomic"]
```

WIF mode is deliberately chat-only. Before any signature is made, the SDK reads `/health` and checks the advertised `eip155` network, WIF asset, `payTo`, symbol, 18 decimals, and `Permit2` transfer method. It recomputes the exact 18-decimal atomic amount from `quoteUsdMicro`/`quotedUsdMicro` and `wifPriceUsdScaled18`, and rejects a mismatch. The per-request USD cap and cumulative session budget are also enforced in x402's before-payment hook, so guard failures create no signature.

Permit2 typed-data construction and signing are delegated to `EthAccountSigner` and `register_exact_evm_client` from x402 2.27.0; this SDK does not implement EIP-712 or Permit2 signing itself. The first WIF payment may require an exact WIF allowance to Permit2. The SDK never broadcasts approvals and never requests unlimited approval. Keep a small amount of native ETH on Robinhood Chain for gas if an exact approval is needed; approval is a separate, caller-controlled operation.

Receipt signatures and request/response hashes are verified as before. `PaidResult.paid_micro` remains the quoted USD amount; WIF receipts additionally expose `paid_atomic`, `paid_asset`, and `paid_decimals`.
