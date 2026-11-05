"""Moltworld Python SDK for x402 Algorand and Robinhood Chain WIF payments.

Algorand remains the default legacy path. For WIF chat payments, pass an EVM
private key; Permit2 signing is delegated to the official x402 Python SDK.

    from moltworld import MoltworldClient
    client = MoltworldClient(evm_private_key="0x...", max_per_request_usd=0.25, budget_usd=5)
    result = client.chat("gpt-4o", [{"role": "user", "content": "Hello"}])
"""

from .client import MoltworldClient, MoltworldError, PaidResult, check_receipt, canonical_json
from .mandates import MandatePayer, mandate_terms, parse_credential

__all__ = ["MoltworldClient", "MoltworldError", "PaidResult", "check_receipt", "canonical_json", "MandatePayer", "mandate_terms", "parse_credential"]
__version__ = "1.1.0"
