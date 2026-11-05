from __future__ import annotations

import base64
import hashlib
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union

from algosdk import encoding, mnemonic as algo_mnemonic, transaction
from algosdk.account import address_from_private_key
from algosdk.v2client import algod
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from .mandates import MandatePayer

MICRO = 1_000_000
ALGOD = {
    "mainnet": "https://mainnet-api.algonode.cloud",
    "testnet": "https://testnet-api.algonode.cloud",
}


class MoltworldError(Exception):
    def __init__(self, message: str, status: int, code: Optional[str] = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


@dataclass
class PaidResult:
    data: Any
    request_id: Optional[str]
    receipt: Optional[Dict[str, Any]]
    verified: bool
    paid_micro: int
    replayed: bool


def canonical_json(value: Any) -> str:
    """Same canonical form the gateway signs: sorted keys, no whitespace, non-ASCII kept."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_receipt(receipt: Dict[str, Any], public_key_b64: str, request: Optional[bytes] = None, response: Optional[bytes] = None) -> bool:
    """True when the signature is valid and the hashes match the bytes you sent and received."""
    payload = {k: v for k, v in receipt.items() if k != "sig"}
    sig = base64.urlsafe_b64decode(receipt["sig"] + "=" * (-len(receipt["sig"]) % 4))
    try:
        VerifyKey(base64.b64decode(public_key_b64)).verify(canonical_json(payload).encode("utf-8"), sig)
    except BadSignatureError:
        return False
    if request is not None and _sha256(request) != receipt["requestSha256"]:
        return False
    if response is not None and _sha256(response) != receipt["responseSha256"]:
        return False
    return True


class MoltworldClient:
    """x402 client for Moltworld. Signs Algorand USDC payments locally; keys never leave the process."""

    def __init__(
        self,
        base_url: str = "https://moltworld.xyz",
        private_key: Optional[str] = None,
        mnemonic: Optional[str] = None,
        mandate: Optional[Union[str, Dict[str, Any]]] = None,
        agent_key: Optional[str] = None,
        max_per_request_usd: float = 1.0,
        budget_usd: Optional[float] = None,
        expected_pay_to: Optional[str] = None,
        algod_url: Optional[str] = None,
        timeout: float = 120.0,
    ):
        # A mandate pays as its owner, co-signed by the agent's own key (agent_key).
        self._mandate = MandatePayer(mandate, agent_key) if mandate else None
        if mnemonic:
            private_key = algo_mnemonic.to_private_key(mnemonic)
        if not private_key and not self._mandate:
            raise ValueError("MoltworldClient needs private_key (algosdk base64), mnemonic, or mandate with agent_key.")
        self._sk = private_key
        self.address = self._mandate.owner if self._mandate else address_from_private_key(private_key)
        self.base_url = base_url.rstrip("/")
        self.max_per_request_micro = int(round(max_per_request_usd * MICRO))
        self.budget_micro = None if budget_usd is None else int(round(budget_usd * MICRO))
        self.spent_micro = 0
        self.timeout = timeout
        self._expected_pay_to = expected_pay_to
        self._algod_url = algod_url
        self._health: Optional[Dict[str, Any]] = None
        self._keys: Optional[Dict[str, str]] = None

    # ------------------------------------------------------------------ http
    def _request(self, method: str, path: str, body: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None):
        req = urllib.request.Request(f"{self.base_url}{path}", data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, dict(resp.headers.items()), resp.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers.items()), err.read()

    def _get_json(self, path: str) -> Any:
        status, _, raw = self._request("GET", path)
        if status != 200:
            raise MoltworldError(f"GET {path} failed", status, body=raw.decode("utf-8", "replace"))
        return json.loads(raw)

    def health(self) -> Dict[str, Any]:
        if self._health is None:
            self._health = self._get_json("/health")
        return self._health

    def receipt_keys(self) -> Dict[str, str]:
        if self._keys is None:
            doc = self._get_json("/.well-known/moltworld-receipts.json")
            self._keys = {k["kid"]: k["publicKey"] for k in doc["keys"]}
        return self._keys

    @property
    def spent_usd(self) -> float:
        return self.spent_micro / MICRO

    # -------------------------------------------------------------- payments
    def _algod(self) -> algod.AlgodClient:
        url = self._algod_url or ALGOD["mainnet" if self.health().get("network") == "mainnet" else "testnet"]
        return algod.AlgodClient("", url)

    def _payment_header(self, payment_required: Dict[str, Any]) -> tuple[str, int]:
        accepts = [a for a in payment_required.get("accepts", []) if a.get("scheme") == "exact" and str(a.get("network", "")).startswith("algorand:")]
        if not accepts:
            raise MoltworldError("No Algorand exact payment option offered.", 402)
        req = accepts[0]
        amount = int(req["amount"])
        pay_to = self._expected_pay_to or self.health()["pay_to"]
        if req["payTo"] != pay_to:
            raise MoltworldError(f"Refusing to pay {req['payTo']}; expected {pay_to}.", 402, "unexpected_payee")
        if amount > self.max_per_request_micro:
            raise MoltworldError(f"Price {amount / MICRO} USDC exceeds max_per_request_usd.", 402, "over_request_cap")
        if self.budget_micro is not None and self.spent_micro + amount > self.budget_micro:
            raise MoltworldError("Budget would be exceeded.", 402, "over_budget")

        sp = self._algod().suggested_params()
        fee_payer = (req.get("extra") or {}).get("feePayer")
        stamp = int(time.time() * 1000)
        version = payment_required.get("x402Version", 2)
        if self._mandate:
            if not fee_payer:
                raise MoltworldError("Mandate payments need a facilitator that sponsors fees.", 402, "no_fee_payer")
            try:
                group_b64, index = self._mandate.payment_group(sp, req, amount, fee_payer, version, stamp)
            except ValueError as err:
                raise MoltworldError(str(err), 402, "mandate_refused") from err
            payload = {"x402Version": version, "payload": {"paymentGroup": group_b64, "paymentIndex": index}, "extensions": payment_required.get("extensions"), "resource": payment_required.get("resource"), "accepted": req}
            payload = {k: v for k, v in payload.items() if v is not None}
            return base64.b64encode(json.dumps(payload).encode()).decode(), amount
        pay_sp = transaction.SuggestedParams(0, sp.first, sp.last, sp.gh, sp.gen, flat_fee=True, min_fee=sp.min_fee)
        payment = transaction.AssetTransferTxn(
            sender=self.address,
            sp=pay_sp if fee_payer else sp,
            receiver=req["payTo"],
            amt=amount,
            index=int(req["asset"]),
            note=f"x402-payment-v{version}-{stamp}".encode(),
        )
        if fee_payer:
            # The facilitator sponsors fees: its zero-amount self-payment carries the whole group's fee.
            fee_sp = transaction.SuggestedParams(2 * max(sp.min_fee, 1000), sp.first, sp.last, sp.gh, sp.gen, flat_fee=True, min_fee=sp.min_fee)
            sponsor = transaction.PaymentTxn(sender=fee_payer, sp=fee_sp, receiver=fee_payer, amt=0, note=f"x402-fee-payer-{stamp}".encode())
            group = transaction.assign_group_id([sponsor, payment])
            sponsor, payment = group[0], group[1]
            group_b64 = [encoding.msgpack_encode(sponsor), encoding.msgpack_encode(payment.sign(self._sk))]
            index = 1
        else:
            group_b64 = [encoding.msgpack_encode(payment.sign(self._sk))]
            index = 0
        payload = {
            "x402Version": version,
            "payload": {"paymentGroup": group_b64, "paymentIndex": index},
            "extensions": payment_required.get("extensions"),
            "resource": payment_required.get("resource"),
            "accepted": req,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        return base64.b64encode(json.dumps(payload).encode()).decode(), amount

    # ------------------------------------------------------------------- api
    def quote(self, model: str, body: Dict[str, Any]) -> Dict[str, Any]:
        status, _, raw = self._request("POST", "/v1/quote", json.dumps({**body, "model": model}).encode(), {"Content-Type": "application/json"})
        data = json.loads(raw)
        if status != 200:
            raise MoltworldError(data.get("error", {}).get("message", "quote failed"), status, data.get("error", {}).get("code"), data)
        return data["quote"]

    def call(self, path: str, body: Dict[str, Any]) -> PaidResult:
        request_bytes = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        status, resp_headers, raw = self._request("POST", path, request_bytes, headers)
        lower = {k.lower(): v for k, v in resp_headers.items()}
        paid = 0
        if status == 402 and "payment-required" in lower:
            payment_required = json.loads(base64.b64decode(lower["payment-required"]))
            header, paid = self._payment_header(payment_required)
            self.spent_micro += paid
            status, resp_headers, raw = self._request("POST", path, request_bytes, {**headers, "Payment-Signature": header})
            lower = {k.lower(): v for k, v in resp_headers.items()}
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw.decode("utf-8", "replace")
        if status >= 400:
            err = data.get("error", {}) if isinstance(data, dict) else {}
            raise MoltworldError(err.get("message", f"HTTP {status}"), status, err.get("code"), data)
        receipt = None
        verified = False
        if "moltworld-receipt" in lower:
            encoded = lower["moltworld-receipt"]
            receipt = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            key = self.receipt_keys().get(receipt["kid"])
            verified = bool(key) and check_receipt(receipt, key, request_bytes, raw)
        return PaidResult(
            data=data,
            request_id=lower.get("moltworld-request-id"),
            receipt=receipt,
            verified=verified,
            paid_micro=receipt["amountMicro"] if receipt else paid,
            replayed=lower.get("moltworld-replay") == "true",
        )

    def chat(self, model: str, messages: List[Dict[str, str]], max_tokens: Optional[int] = None, temperature: Optional[float] = None) -> PaidResult:
        body: Dict[str, Any] = {"messages": messages}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        return self.call(f"/v1/models/{model}/chat/completions", body)

    def image(self, model: str, prompt: str, n: int = 1, size: Optional[str] = None) -> PaidResult:
        body: Dict[str, Any] = {"prompt": prompt, "n": n}
        if size:
            body["size"] = size
        return self.call(f"/v1/models/{model}/images/generations", body)

    def speech(self, model: str, text: str, voice: Optional[str] = None) -> PaidResult:
        body: Dict[str, Any] = {"input": text}
        if voice:
            body["voice"] = voice
        return self.call(f"/v1/models/{model}/audio/speech", body)

    def video(self, model: str, prompt: str, duration: Optional[int] = None, wait: bool = False, timeout: float = 900) -> PaidResult:
        body: Dict[str, Any] = {"prompt": prompt}
        if duration:
            body["duration"] = duration
        result = self.call(f"/v1/models/{model}/videos/generations", body)
        if wait:
            result.data = self.wait_for_job(result.data["id"], timeout)
        return result

    def market(self, slug: str, body: Dict[str, Any]) -> PaidResult:
        return self.call(f"/v1/market/{slug}/call", body)

    def job(self, job_id: str) -> Dict[str, Any]:
        return self._get_json(f"/v1/jobs/{job_id}")

    def wait_for_job(self, job_id: str, timeout: float = 900, interval: float = 5) -> Dict[str, Any]:
        deadline = time.time() + timeout
        while True:
            job = self.job(job_id)
            if job["status"] in ("completed", "failed"):
                return job
            if time.time() > deadline:
                raise TimeoutError(f"Job {job_id} still {job['status']}")
            time.sleep(interval)
