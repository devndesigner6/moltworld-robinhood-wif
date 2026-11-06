"""Moltworld Python SDK for Algorand legacy and x402 WIF EVM calls.

The WIF private-key payer is restricted to explicit local development with a
dedicated EOA and process-local caps; it is not an owner-authorized mandate.
Permit2 signing is delegated to the official x402 Python SDK. Never give an
agent a user's master wallet key. The live WIF model surface is chat-only.

    from moltworld import MoltworldClient
    result = client.chat("gpt-4o", [{"role": "user", "content": "Hello"}])
"""

from .client import MoltworldClient, MoltworldError, PaidResult, check_receipt, canonical_json
from .mandates import MandatePayer, mandate_terms, parse_credential

__all__ = ["MoltworldClient", "MoltworldError", "PaidResult", "check_receipt", "canonical_json", "MandatePayer", "mandate_terms", "parse_credential"]
__version__ = "1.1.0"
