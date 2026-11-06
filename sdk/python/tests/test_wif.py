import os
import unittest
from unittest.mock import patch

from eth_account import Account
from x402 import x402ClientSync
from x402.mechanisms.evm.constants import X402_EXACT_PERMIT2_PROXY_ADDRESS
from x402.mechanisms.evm.exact import register_exact_evm_client
from x402.mechanisms.evm.signers import EthAccountSigner
from x402.schemas import PaymentRequired, PaymentRequirements

from moltworld import MoltworldClient, MoltworldError
from moltworld.client import EVM_EOA_AUTOPAY_ACK


NETWORK = "eip155:4663"
ASSET = "0x5173b8eA6923c2d40267890D45C46a3480954773"
PAY_TO = "0x00000000000000000000000000000000000000aa"
PRICE = 2_000_000_000_000_000_000
QUOTE = 1_000_000
ATOMIC = "500000000000000000"


def requirements(amount=ATOMIC, **extra):
    return PaymentRequirements(
        scheme="exact",
        network=NETWORK,
        asset=ASSET,
        amount=amount,
        payTo=PAY_TO,
        maxTimeoutSeconds=3600,
        extra={
            "assetTransferMethod": "permit2",
            "symbol": "WIF",
            "decimals": 18,
            "quotedUsdMicro": QUOTE,
            "wifPriceUsdScaled18": PRICE,
            **extra,
        },
    )


class WifSdkTests(unittest.TestCase):
    def make_client(self):
        env = {
            "NODE_ENV": "test",
            "MOLTWORLD_ENV": "local",
            "MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY": EVM_EOA_AUTOPAY_ACK,
            "MOLTWORLD_EVM_KEY_ROLE": "dedicated",
        }
        with patch.dict(os.environ, env, clear=True):
            client = MoltworldClient(evm_private_key="0x" + "11" * 32, max_per_request_usd=2, budget_usd=2)
        client._health = {
            "payment_chain": "robinhood",
            "network_caip2": NETWORK,
            "payment_asset": ASSET,
            "payment_symbol": "WIF",
            "payment_decimals": 18,
            "pay_to": PAY_TO,
        }
        return client

    def test_official_x402_permit2_payload_shape(self):
        account = Account.from_key("0x" + "22" * 32)
        x402 = x402ClientSync()
        register_exact_evm_client(x402, EthAccountSigner(account), networks=NETWORK)
        x402.set_spend_controls(False)
        required = PaymentRequired(accepts=[requirements()])
        payload = x402.create_payment_payload(required)
        auth = payload.payload["permit2Authorization"]
        self.assertEqual(auth["from"], account.address)
        self.assertEqual(auth["permitted"]["token"].lower(), ASSET.lower())
        self.assertEqual(auth["permitted"]["amount"], ATOMIC)
        self.assertEqual(auth["witness"]["to"].lower(), PAY_TO.lower())
        self.assertEqual(auth["witness"]["validAfter"], "0")
        self.assertEqual(auth["spender"], X402_EXACT_PERMIT2_PROXY_ADDRESS)
        self.assertTrue(payload.payload["signature"].startswith("0x"))

    def test_guard_rejects_exact_atomic_mismatch(self):
        client = self.make_client()
        with self.assertRaises(MoltworldError) as ctx:
            client._validate_wif_requirement(requirements(amount="500000000000000001"))
        self.assertEqual(ctx.exception.code, "amount_mismatch")

    def test_guard_rejects_wrong_chain_and_budget_before_signing(self):
        client = self.make_client()
        bad = requirements()
        bad.network = "eip155:46630"
        with self.assertRaises(MoltworldError) as ctx:
            client._validate_wif_requirement(bad)
        self.assertEqual(ctx.exception.code, "unexpected_network")

        client.spent_micro = 1_500_000
        with self.assertRaises(MoltworldError) as ctx:
            client._validate_wif_requirement(requirements())
        self.assertEqual(ctx.exception.code, "over_budget")

    def test_non_chat_rejected_without_http_or_signature(self):
        client = self.make_client()
        with self.assertRaises(MoltworldError) as ctx:
            client.image("model", "prompt")
        self.assertEqual(ctx.exception.code, "wif_endpoint_unsupported")

    def test_marketplace_path_is_available_but_disabled_server_response_is_not_paid(self):
        client = self.make_client()
        with patch.object(client, "_request", return_value=(503, {}, b'{"error":{"message":"disabled"}}')) as request:
            with self.assertRaises(MoltworldError) as ctx:
                client.market("weather-api", {"city": "Lagos"})
        self.assertEqual(ctx.exception.status, 503)
        request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
