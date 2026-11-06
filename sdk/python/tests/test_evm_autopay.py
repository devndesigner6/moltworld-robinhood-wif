import os
import unittest
from unittest.mock import patch

from moltworld.client import EVM_EOA_AUTOPAY_ACK, MoltworldClient


KEY = "0x" + "11" * 32


class EvmEoaAutopayGuardTests(unittest.TestCase):
    def test_default_refusal(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "outside local/development"):
                MoltworldClient(evm_private_key=KEY)

    def test_explicit_local_only_opt_in(self):
        env = {
            "NODE_ENV": "test",
            "MOLTWORLD_ENV": "local",
            "MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY": EVM_EOA_AUTOPAY_ACK,
            "MOLTWORLD_EVM_KEY_ROLE": "dedicated",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertWarnsRegex(RuntimeWarning, "local EVM EOA auto-payment is enabled"):
                client = MoltworldClient(evm_private_key=KEY)
        self.assertTrue(client._evm)
        self.assertRegex(client.address, r"^0x[0-9a-fA-F]{40}$")

    def test_production_refusal_even_with_acknowledgement(self):
        env = {
            "NODE_ENV": "production",
            "MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY": EVM_EOA_AUTOPAY_ACK,
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ValueError, "production"):
                MoltworldClient(evm_private_key=KEY)

    def test_master_key_role_is_rejected(self):
        env = {
            "NODE_ENV": "development",
            "MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY": EVM_EOA_AUTOPAY_ACK,
            "MOLTWORLD_EVM_KEY_ROLE": "master",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ValueError, "master/primary wallet key"):
                MoltworldClient(evm_private_key=KEY)

    def test_missing_dedicated_role_is_rejected(self):
        env = {
            "NODE_ENV": "development",
            "MOLTWORLD_ALLOW_EVM_EOA_AUTOPAY": EVM_EOA_AUTOPAY_ACK,
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ValueError, "master/primary wallet key"):
                MoltworldClient(evm_private_key=KEY)


if __name__ == "__main__":
    unittest.main()
