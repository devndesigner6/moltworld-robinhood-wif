# moltworld (Python)

Python client for Moltworld's x402 gateway. The package retains the legacy Algorand path and includes a Robinhood Chain WIF EVM payer for **local development only**. Its process budgets are not an owner-authorized on-chain mandate. For user-approved per-call signing, use a connected browser wallet or the caller-signed remote MCP relay instead; never give an agent the owner's/master wallet key.

The currently live WIF model surface is chat-only. Image, speech, video, agent mandates, automatic WIF refunds, and marketplace payments are not enabled. `market()` is guarded and returns unavailable while the service feature remains disabled.

## Legacy Algorand

```python
from moltworld import MoltworldClient

client = MoltworldClient(mnemonic="...", max_per_request_usd=0.25, budget_usd=5)
result = client.chat("gpt-4o", [{"role": "user", "content": "Hi"}], max_tokens=300)
print(result.data["choices"][0]["message"]["content"], result.verified, result.receipt["txid"])
```

Keep Algorand credentials isolated from the WIF deployment. LogicSig mandates are legacy-only and do not transfer to an EVM chain.

## WIF local development only

Install the package from this repository with `pip install ./sdk/python`, then set `MOLTWORLD_EVM_PRIVATE_KEY` in your local secret manager or shell. Before constructing a client, explicitly acknowledge that this is a dedicated local EOA, not a mandate:

```python
import os
from moltworld import MoltworldClient

# Local/development only. Use a disposable, separately funded EOA; never a user's master wallet.
os.environ["MOLTWORLD_ENV"] = "local"
os.environ["MOLTWORLD_EVM_KEY_ROLE"] = "dedicated"
os.environ["MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY"] = "I_UNDERSTAND_LOCAL_EVM_EOA_AUTOPAY_IS_NOT_A_MANDATE"

client = MoltworldClient(
    evm_private_key=os.environ["MOLTWORLD_EVM_PRIVATE_KEY"],
    base_url="https://motoworld-wif.vercel.app",
    max_per_request_usd=0.25,
    budget_usd=5,
)
result = client.chat("gpt-4o", [{"role": "user", "content": "Hi"}], max_tokens=300)
print(result.data["choices"][0]["message"]["content"])
print(result.paid_atomic, result.receipt["amountAtomic"])
```

The guard refuses production, unspecified environments, master/primary keys, or missing acknowledgement. The client checks the advertised chain, WIF contract, recipient, quote-bound amount, 18 decimals, and Permit2 method before signing. It never submits an approval transaction; a first payment may require a separate exact WIF allowance and native ETH for gas. The remote MCP path never holds a wallet key and relays caller-signed payment payloads.

`market(slug, body)` uses the same bounded x402 checks, but the WIF marketplace is disabled by default and returns unavailable before payment. WIF creator payout verification and on-chain agent mandates are not implemented.
