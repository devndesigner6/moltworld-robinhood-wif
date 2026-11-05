"""Interop check: the Python SDK pays a running gateway. Prints one JSON line."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk", "python"))
from moltworld import MoltworldClient, MoltworldError  # noqa: E402

client = MoltworldClient(
    base_url=os.environ["GATEWAY_URL"],
    private_key=os.environ["PAYER_SK"],
    algod_url=os.environ["ALGOD_URL"],
    max_per_request_usd=0.5,
    budget_usd=float(os.environ.get("BUDGET_USD", "1")),
)
out = {"address": client.address}
quote = client.quote("gpt-4o", {"messages": [{"role": "user", "content": "Grüße aus Lagos 🌍"}], "max_tokens": 300})
result = client.chat("gpt-4o", [{"role": "user", "content": "Grüße aus Lagos 🌍"}], max_tokens=300)
out.update(
    quote_micro=quote["microUsdc"],
    paid_micro=result.paid_micro,
    verified=result.verified,
    payer=result.receipt["payer"],
    txid=result.receipt["txid"],
    content=result.data["choices"][0]["message"]["content"],
)
try:
    client.chat("gpt-5.4-pro", [{"role": "user", "content": "x"}], max_tokens=4000)
    out["cap_enforced"] = False
except MoltworldError as err:
    out["cap_enforced"] = err.code == "over_request_cap"
if os.environ.get("MANDATE"):
    # Paying as an agent under a capped mandate bound to its own key.
    try:
        MoltworldClient(base_url=os.environ["GATEWAY_URL"], mandate=os.environ["MANDATE"], algod_url=os.environ["ALGOD_URL"])
        out["credential_alone_refused"] = False
    except ValueError:
        out["credential_alone_refused"] = True
    agent = MoltworldClient(
        base_url=os.environ["GATEWAY_URL"],
        mandate=os.environ["MANDATE"],
        agent_key=os.environ["AGENT_SK"],
        algod_url=os.environ["ALGOD_URL"],
        max_per_request_usd=0.5,
    )
    paid = agent.chat("gpt", [{"role": "user", "content": "paid by a mandate from Python"}], max_tokens=100)
    out.update(mandate_payer=paid.receipt["payer"], mandate_verified=paid.verified, mandate_txid=paid.receipt["txid"], mandate_paid=paid.paid_micro)
print(json.dumps(out))
