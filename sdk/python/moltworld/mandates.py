"""Paying under a Moltworld spending mandate.

A mandate is a delegated LogicSig the owner signs once. It is bound to the agent's own
key: every payment carries the agent's ed25519 signature over the transaction id, so the
credential alone cannot pay. Capped mandates also require each payment to be followed by
a call to the on-chain spend counter, which enforces the daily cap.
"""
from __future__ import annotations

import base64
import hashlib
import json
import struct
from typing import Any, Dict, List, Optional, Tuple, Union

from algosdk import encoding, logic, transaction
from algosdk.account import address_from_private_key


def parse_credential(credential: Union[str, Dict[str, Any]]) -> Dict[str, str]:
    """Accepts the MOLTWORLD_MANDATE value (base64 JSON) or the credential dict."""
    value = json.loads(base64.b64decode(credential)) if isinstance(credential, str) else dict(credential)
    for key in ("owner", "programB64", "delegationSigB64"):
        if not isinstance(value.get(key), str):
            raise ValueError(f"Not a mandate credential: missing {key}.")
    return value


def _uvarint(data: bytes, i: int) -> Tuple[int, int]:
    result, shift = 0, 0
    while True:
        byte = data[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7


def mandate_terms(program: bytes) -> Optional[Dict[str, Any]]:
    """Terms of a mandate program: payee, asset, limits, salt, agent and on-chain cap."""
    ints: List[int] = []
    blobs: List[bytes] = []
    i = 1
    while i < len(program):
        op = program[i]
        i += 1
        if op == 0x81:
            value, i = _uvarint(program, i)
            ints.append(value)
        elif op == 0x80:
            length, i = _uvarint(program, i)
            blobs.append(program[i : i + length])
            i += length
        elif op in (0x31, 0x32, 0x38):
            i += 1
        elif op in (0x39, 0x40):
            i += 2
    if len(ints) == 19 and len(blobs) == 5:
        return {
            "pay_to": encoding.encode_address(blobs[0]),
            "asset_id": ints[2],
            "max_per_call_micro": ints[3],
            "expiry_round": ints[5],
            "agent": encoding.encode_address(blobs[1]),
            "salt": blobs[2],
            "counter": {"app_id": ints[7], "cap_micro": struct.unpack(">Q", blobs[3])[0], "window_rounds": struct.unpack(">Q", blobs[4])[0]},
        }
    if len(ints) == 6 and len(blobs) in (2, 3):
        bound = len(blobs) == 3
        return {
            "pay_to": encoding.encode_address(blobs[0]),
            "asset_id": ints[1],
            "max_per_call_micro": ints[2],
            "expiry_round": ints[4],
            "agent": encoding.encode_address(blobs[1]) if bound else None,
            "salt": blobs[2 if bound else 1],
            "counter": None,
        }
    return None


def counter_box_name(owner: str, salt: bytes) -> bytes:
    return hashlib.sha256(encoding.decode_address(owner) + salt).digest()


class MandatePayer:
    """Signs x402 payment groups as the mandate's owner, with the agent's co-signature."""

    def __init__(self, credential: Union[str, Dict[str, Any]], agent_key: Optional[str]):
        self.credential = parse_credential(credential)
        self.owner = self.credential["owner"]
        self.program = base64.b64decode(self.credential["programB64"])
        terms = mandate_terms(self.program)
        if terms is None:
            raise ValueError("Credential does not hold a Moltworld mandate program.")
        self.terms = terms
        self._lsig = transaction.LogicSigAccount(self.program)
        self._lsig.lsig.sig = self.credential["delegationSigB64"]
        self._lsig.sigkey = encoding.decode_address(self.owner)
        if not self._lsig.verify():
            raise ValueError("Mandate credential's delegation signature does not match the owner.")
        self._agent_key = None
        if terms["agent"]:
            if not agent_key:
                raise ValueError(f"This mandate is bound to agent {terms['agent']}; provide that agent's key.")
            if address_from_private_key(agent_key) != terms["agent"]:
                raise ValueError(f"Agent key is not the key this mandate is bound to ({terms['agent']}).")
            self._agent_key = agent_key

    def _sign(self, txn: transaction.Transaction, co_sign: bool) -> str:
        if co_sign and self._agent_key:
            raw_txid = base64.b32decode(txn.get_txid() + "=" * (-len(txn.get_txid()) % 8))
            self._lsig.lsig.args = [logic.teal_sign_from_program(self._agent_key, raw_txid, self.program)]
        else:
            self._lsig.lsig.args = []
        return encoding.msgpack_encode(transaction.LogicSigTransaction(txn, self._lsig))

    def payment_group(self, sp: transaction.SuggestedParams, req: Dict[str, Any], amount: int, fee_payer: str, version: int, stamp: int) -> Tuple[List[str], int]:
        t = self.terms
        if req["payTo"] != t["pay_to"] or int(req["asset"]) != t["asset_id"]:
            raise ValueError("The mandate can only pay its own payee in its own asset.")
        if amount > t["max_per_call_micro"]:
            raise ValueError("Amount is over the mandate's per-call limit.")
        last = min(sp.last, t["expiry_round"])
        zero = transaction.SuggestedParams(0, sp.first, last, sp.gh, sp.gen, flat_fee=True, min_fee=sp.min_fee)
        transfer = transaction.AssetTransferTxn(sender=self.owner, sp=zero, receiver=t["pay_to"], amt=amount, index=t["asset_id"], note=f"x402-payment-v{version}-{stamp}".encode())
        counter = t["counter"]
        txns: List[transaction.Transaction] = [transfer]
        if counter:
            txns.append(
                transaction.ApplicationNoOpTxn(
                    sender=self.owner,
                    sp=zero,
                    index=counter["app_id"],
                    app_args=[b"spend", t["salt"], struct.pack(">Q", counter["cap_micro"]), struct.pack(">Q", counter["window_rounds"])],
                    boxes=[(counter["app_id"], counter_box_name(self.owner, t["salt"]))],
                )
            )
        # The facilitator's zero-amount self-payment pays the whole group's minimum fee.
        fee_sp = transaction.SuggestedParams((len(txns) + 1) * max(sp.min_fee, 1000), sp.first, last, sp.gh, sp.gen, flat_fee=True, min_fee=sp.min_fee)
        sponsor = transaction.PaymentTxn(sender=fee_payer, sp=fee_sp, receiver=fee_payer, amt=0, note=f"x402-fee-payer-{stamp}".encode())
        group = transaction.assign_group_id([sponsor, *txns])
        encoded = [encoding.msgpack_encode(group[0]), self._sign(group[1], co_sign=True)]
        if counter:
            encoded.append(self._sign(group[2], co_sign=False))
        return encoded, 1
