import algosdk from "algosdk";
import { findDefaultAsset } from "@x402/avm";
import { counterBoxName, SPEND_SELECTOR, u64 } from "./counter.js";
import { fromBase64, toBase64, utf8 } from "./encoding.js";
import { createMandateSigner, mandateTermsFromProgram, type MandateCredential, type MandateTerms } from "./mandates.js";

const PUBLIC_ALGOD = { mainnet: "https://mainnet-api.algonode.cloud", testnet: "https://testnet-api.algonode.cloud" };
const MAINNET_GENESIS_PREFIX = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73k";

type CappedTerms = MandateTerms & { counter: NonNullable<MandateTerms["counter"]>; agent: string };

interface PaymentRequirements {
  amount: string;
  asset: string;
  payTo: string;
  network: string;
  extra?: { feePayer?: string };
}

/**
 * x402 "exact" payments for a mandate whose daily cap is enforced on-chain. The group is
 * the one the standard AVM client builds (facilitator fee payer, then the USDC transfer)
 * plus the spend counter call the mandate's program requires right after the transfer:
 *
 *   [0] fee payer: 0 ALGO to itself, pays the whole group's fee (signed by the facilitator)
 *   [1] USDC to Moltworld, signed by the mandate with the agent's co-signature
 *   [2] spend counter call (salt, cap, window), signed by the mandate
 */
export class CappedMandateScheme {
  readonly scheme = "exact";
  /** Lets x402 spend controls recognise USDC, as the standard AVM client does. */
  readonly findDefaultAsset = findDefaultAsset;
  private readonly terms: CappedTerms;
  private readonly signer: ReturnType<typeof createMandateSigner>;

  constructor(private readonly credential: MandateCredential, agentKey: string | undefined, private readonly algodUrl?: string) {
    const terms = mandateTermsFromProgram(fromBase64(credential.programB64));
    if (!terms?.counter || !terms.agent) throw new Error("CappedMandateScheme needs a mandate capped on-chain.");
    this.terms = terms as CappedTerms;
    this.signer = createMandateSigner(credential, agentKey);
  }

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements) {
    const { counter } = this.terms;
    const feePayer = requirements.extra?.feePayer;
    if (!feePayer) throw new Error("Capped mandate payments need a facilitator that sponsors fees.");
    if (requirements.payTo !== this.terms.payTo) throw new Error(`Mandate can only pay ${this.terms.payTo}.`);
    if (Number(requirements.asset) !== this.terms.assetId) throw new Error("Mandate can only pay in its own asset.");
    const amount = BigInt(requirements.amount);
    if (amount > BigInt(this.terms.maxPerCallMicro)) throw new Error("Amount is over the mandate's per-call limit.");

    const mainnet = requirements.network.includes(MAINNET_GENESIS_PREFIX);
    // No port argument: algosdk would replace the URL's own port with it.
    const algod = new algosdk.Algodv2("", this.algodUrl ?? (mainnet ? PUBLIC_ALGOD.mainnet : PUBLIC_ALGOD.testnet));
    const sp = await algod.getTransactionParams().do();
    const params = { ...sp, flatFee: true, fee: 0n, lastValid: BigInt(Math.min(Number(sp.lastValid), this.terms.expiryRound)) };
    const owner = this.credential.owner;

    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: feePayer, receiver: feePayer, amount: 0, note: utf8(`x402-fee-payer-${Date.now()}`), suggestedParams: params,
    });
    const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: owner, receiver: requirements.payTo, assetIndex: this.terms.assetId, amount, note: utf8(`x402-payment-v${x402Version}-${Date.now()}`), suggestedParams: params,
    });
    const count = algosdk.makeApplicationNoOpTxnFromObject({
      sender: owner,
      appIndex: counter.appId,
      appArgs: [utf8(SPEND_SELECTOR), this.terms.salt, u64(counter.capMicro), u64(counter.windowRounds)],
      boxes: [{ appIndex: counter.appId, name: counterBoxName(owner, this.terms.salt) }],
      suggestedParams: params,
    });

    // The fee payer covers the group, at the protocol's per-byte rate or the minimum per transaction.
    const feePerByte = Number(sp.fee);
    const minFee = Number(sp.minFee);
    const total = [pay, transfer, count].reduce((sum, t) => sum + Math.max(feePerByte * algosdk.encodeUnsignedTransaction(t).length, minFee), 0);
    const group = algosdk.assignGroupID([
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: feePayer, receiver: feePayer, amount: 0, note: pay.note, suggestedParams: { ...params, fee: BigInt(total) } }),
      transfer,
      count,
    ]);

    const encoded = group.map((t) => algosdk.encodeUnsignedTransaction(t));
    const signed = await this.signer.signTransactions(encoded, [1, 2]);
    return {
      x402Version,
      payload: { paymentGroup: encoded.map((bytes, i) => toBase64(signed[i] ?? bytes)), paymentIndex: 1 },
    };
  }
}
