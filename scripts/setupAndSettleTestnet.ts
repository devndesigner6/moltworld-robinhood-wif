import "dotenv/config";
import { AlgorandClient, microAlgo } from "@algorandfoundation/algokit-utils";
import { toClientAvmSigner, getAlgokitSigner, ExactAvmScheme } from "@x402/avm";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";

export const TESTNET_CONFIG = {
  usdcAsaId: 10458941n,
  client: {
    address: process.env.AVM_CLIENT_ADDRESS || (process.env.AVM_CLIENT_PRIVATE_KEY ? toClientAvmSigner(process.env.AVM_CLIENT_PRIVATE_KEY).address : ""),
    secretKeyBase64: process.env.AVM_CLIENT_PRIVATE_KEY || "",
  },
  merchant: {
    address: process.env.AVM_ADDRESS || "TQWEL54TCBYH3QJLN2OU2QH7XZTHRDZMF2YQIU5B7W2HK6GS7I2TWHDMXU",
    secretKeyBase64: process.env.AVM_MERCHANT_PRIVATE_KEY || "",
  },
};

export async function getAccountBalances(address: string) {
  const client = AlgorandClient.testNet();
  try {
    const info = await client.account.getInformation(address);
    const algoBalance = Number(info.amount) / 1e6;
    const usdcAsset = info.assets?.find((a: any) => BigInt(a.assetId) === TESTNET_CONFIG.usdcAsaId);
    const usdcBalance = usdcAsset ? Number(usdcAsset.amount) / 1e6 : 0;
    const optedIn = !!usdcAsset;
    return { exists: true, algoBalance, usdcBalance, optedIn };
  } catch (err: any) {
    if (err?.message?.includes("404") || err?.message?.includes("not found")) {
      return { exists: false, algoBalance: 0, usdcBalance: 0, optedIn: false };
    }
    throw err;
  }
}

export async function prepareAccounts() {
  const client = AlgorandClient.testNet();
  const clientSigner = toClientAvmSigner(TESTNET_CONFIG.client.secretKeyBase64);
  const merchantSigner = toClientAvmSigner(TESTNET_CONFIG.merchant.secretKeyBase64);
  const clientAlgokit = getAlgokitSigner(clientSigner);
  const merchantAlgokit = getAlgokitSigner(merchantSigner);

  console.log("\n======================================================");
  console.log(" Preparing Accounts for Testnet Settlement");
  console.log("======================================================");

  const clientBal = await getAccountBalances(clientSigner.address);
  console.log(`\nClient Address (${clientSigner.address}):`);
  console.log(`- ALGO Balance: ${clientBal.algoBalance.toFixed(4)} ALGO`);
  console.log(`- USDC Balance: ${clientBal.usdcBalance.toFixed(4)} USDC`);
  console.log(`- USDC Opted In: ${clientBal.optedIn ? "YES" : "NO"}`);

  if (clientBal.algoBalance < 0.3) {
    throw new Error(`Client account needs at least 0.3 ALGO to proceed. Current: ${clientBal.algoBalance}`);
  }

  // Step 1: Opt-in Client if needed
  if (!clientBal.optedIn) {
    console.log(`\n[1/3] Opting in Client to USDC ASA ${TESTNET_CONFIG.usdcAsaId}...`);
    const optRes = await client.newGroup()
      .addAssetOptIn({
        sender: clientSigner.address,
        assetId: TESTNET_CONFIG.usdcAsaId,
        signer: clientAlgokit.signer,
      })
      .send();
    console.log(`✅ Client opted in! TxID: ${optRes.txIds?.[0]}`);
  } else {
    console.log(`\n[1/3] Client already opted in to USDC.`);
  }

  // Step 2: Fund Merchant with 0.3 ALGO if needed
  const merchantBal = await getAccountBalances(merchantSigner.address);
  console.log(`\nMerchant Address (${merchantSigner.address}):`);
  console.log(`- ALGO Balance: ${merchantBal.algoBalance.toFixed(4)} ALGO`);
  console.log(`- USDC Opted In: ${merchantBal.optedIn ? "YES" : "NO"}`);

  if (merchantBal.algoBalance < 0.2) {
    console.log(`\n[2/3] Transferring 0.3 ALGO from Client to Merchant...`);
    const payRes = await client.newGroup()
      .addPayment({
        sender: clientSigner.address,
        receiver: merchantSigner.address,
        amount: microAlgo(300_000),
        signer: clientAlgokit.signer,
      })
      .send();
    console.log(`✅ Funded Merchant with 0.3 ALGO! TxID: ${payRes.txIds?.[0]}`);
  } else {
    console.log(`\n[2/3] Merchant already holds sufficient ALGO.`);
  }

  // Step 3: Opt-in Merchant to USDC if needed
  const updatedMerchantBal = await getAccountBalances(merchantSigner.address);
  if (!updatedMerchantBal.optedIn) {
    console.log(`\n[3/3] Opting in Merchant to USDC ASA ${TESTNET_CONFIG.usdcAsaId}...`);
    const optRes = await client.newGroup()
      .addAssetOptIn({
        sender: merchantSigner.address,
        assetId: TESTNET_CONFIG.usdcAsaId,
        signer: merchantAlgokit.signer,
      })
      .send();
    console.log(`✅ Merchant opted in! TxID: ${optRes.txIds?.[0]}`);
  } else {
    console.log(`\n[3/3] Merchant already opted in to USDC.`);
  }

  console.log(`\n🎉 Both Client and Merchant accounts are completely prepared and opted in!`);
}

export async function executeLiveSettlement(targetUrl = "https://moltworld.xyz", modelSlug = "gemini-lite") {
  const clientSigner = toClientAvmSigner(TESTNET_CONFIG.client.secretKeyBase64);
  const endpoint = `${targetUrl}/v1/models/${modelSlug}/chat/completions`;
  const payload = {
    messages: [{ role: "user", content: "What is Algorand in 1 concise sentence?" }],
    temperature: 0.7,
    max_tokens: 100,
  };

  console.log(`\n======================================================`);
  console.log(` Executing Live x402 Settlement via GoPlausible`);
  console.log(` Endpoint: ${endpoint}`);
  console.log(` Payer:    ${clientSigner.address}`);
  console.log(` Model:    ${modelSlug}`);
  console.log(`======================================================\n`);

  const x402 = new x402Client().register("algorand:*", new ExactAvmScheme(clientSigner));
  const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, x402);

  console.log(`Sending x402 paid request...`);
  const startTime = Date.now();
  const res = await fetchWithPay(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const durationMs = Date.now() - startTime;
  console.log(`HTTP Status: ${res.status} (${durationMs}ms)`);

  const paymentResponseHeader = res.headers.get("payment-response");
  if (paymentResponseHeader) {
    const settlement = decodePaymentResponseHeader(paymentResponseHeader) as any;
    const txId = settlement.txId || settlement.transactionId || settlement.transaction || settlement.transactionHash || settlement.id || settlement.txHash || settlement.txid;
    console.log(`\n======================================================`);
    console.log(` 🏆 SETTLEMENT CONFIRMED BY GOPLAUSIBLE FACILITATOR!`);
    console.log(`- Settlement Payload:`, JSON.stringify(settlement));
    console.log(`- Transaction ID: ${txId || "(Confirmed on-chain)"}`);
    console.log(`- Network:        ${settlement.network || "algorand:testnet"}`);
    if (txId) {
      console.log(`- Explorer URL:   https://lora.algokit.io/testnet/transaction/${txId}`);
    }
    console.log(`======================================================\n`);
  } else {
    console.log("No payment-response header found.");
  }

  if (res.ok) {
    const data = await res.json() as any;
    console.log(`AI Model Inference Output (${data.model}):`);
    console.log(data.choices?.[0]?.message?.content || JSON.stringify(data));
    console.log(`\n✨ Testnet settlement and paid AI inference completed successfully!`);
    return { success: true, status: res.status };
  } else {
    const errText = await res.text();
    console.error(`Request failed with status ${res.status}:`, errText);
    return { success: false, status: res.status, error: errText };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode === "prepare") {
    prepareAccounts().catch(console.error);
  } else if (mode === "settle") {
    executeLiveSettlement().catch(console.error);
  } else {
    // Default: Check balances and wait or settle
    (async () => {
      const clientBal = await getAccountBalances(TESTNET_CONFIG.client.address);
      console.log(`Client Address: ${TESTNET_CONFIG.client.address}`);
      console.log(`- ALGO: ${clientBal.algoBalance} | USDC: ${clientBal.usdcBalance} | OptedIn: ${clientBal.optedIn}`);
      if (clientBal.algoBalance >= 0.3 && clientBal.usdcBalance >= 0.01) {
        await prepareAccounts();
        await executeLiveSettlement();
      } else {
        console.log(`\nWaiting for funds. Client needs: >= 0.3 ALGO and >= 0.01 USDC.`);
      }
    })().catch(console.error);
  }
}
