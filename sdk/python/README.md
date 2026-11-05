# moltworld (Python)

Pay-per-request AI on Algorand over x402. Payments are signed locally with py-algorand-sdk;
receipts are verified with the gateway's published Ed25519 key.

```python
from moltworld import MoltworldClient

client = MoltworldClient(mnemonic="...", max_per_request_usd=0.25, budget_usd=5)
print(client.quote("gpt-4o", {"messages": [{"role": "user", "content": "Hi"}], "max_tokens": 300}))
result = client.chat("gpt-4o", [{"role": "user", "content": "Hi"}], max_tokens=300)
print(result.data["choices"][0]["message"]["content"], result.verified, result.receipt["txid"])

```

The client refuses to pay any address other than the gateway's published `pay_to`, anything
above `max_per_request_usd`, and anything beyond `budget_usd`.
