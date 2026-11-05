import "dotenv/config";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactAvmScheme, toClientAvmSigner } from "@x402/avm";
import crypto from "crypto";
import { ed25519Generator } from "@algorandfoundation/algokit-utils/crypto";

// Helper to generate or load an Algorand signer
function getClientSigner() {
  const envKey = process.env.AVM_CLIENT_PRIVATE_KEY || process.env.AVM_PRIVATE_KEY;
  if (envKey) {
    return toClientAvmSigner(envKey);
  }

  // Generate an ephemeral client account for testing
  const seed = crypto.randomBytes(32);
  const keypair = ed25519Generator(seed);
  const sk = Buffer.concat([seed, Buffer.from(keypair.ed25519Pubkey)]);
  return toClientAvmSigner(sk.toString("base64"));
}

export async function runTestClient(options: {
  targetUrl?: string;
  modality?: "chat" | "image" | "voice" | "video";
  modelSlug?: string;
  prompt?: string;
} = {}): Promise<void> {
  const baseUrl = options.targetUrl || process.env.MOLTWORLD_URL || "http://localhost:3000";
  const modality = options.modality || (process.env.TEST_MODALITY as any) || "chat";
  
  let defaultModel = "gpt";
  if (modality === "image") defaultModel = "gpt-image-1.5";
  if (modality === "voice") defaultModel = "tts-1";
  if (modality === "video") throw new Error("Video generation is no longer available.");
  const modelSlug = options.modelSlug || process.env.TEST_MODEL || defaultModel;

  let endpoint = `${baseUrl}/v1/models/${modelSlug}/chat/completions`;
  let payload: any = {
    messages: [{ role: "user", content: options.prompt || "Explain Algorand in simple terms." }],
    temperature: 0.7,
    max_tokens: 300,
  };

  if (modality === "image") {
    endpoint = `${baseUrl}/v1/models/${modelSlug}/images/generations`;
    payload = {
      prompt: options.prompt || "Futuristic holographic datacenter in cyberspace, neon glowing wires",
      size: "1024x1024",
      n: 1,
    };
  } else if (modality === "voice") {
    endpoint = `${baseUrl}/v1/models/${modelSlug}/audio/speech`;
    payload = {
      input: options.prompt || "Welcome to Moltworld, powered by Algorand x402 payments.",
      voice: "alloy",
      response_format: "mp3",
    };
  } else if (modality === "video") {
    endpoint = `${baseUrl}/v1/models/${modelSlug}/videos/generations`;
    payload = {
      prompt: options.prompt || "Cinematic aerial view of turquoise waves crashing on volcanic rocks at golden hour",
      duration: 5,
      aspect_ratio: "16:9",
    };
  }

  console.log(`\n======================================================`);
  console.log(` Moltworld x402 Multimodal Client Demo`);
  console.log(` Modality: [${modality.toUpperCase()}]`);
  console.log(` Model:    ${modelSlug}`);
  console.log(` Endpoint: ${endpoint}`);
  console.log(`======================================================\n`);

  // Step 1: Send initial request without payment
  console.log(`[Step 1] Sending initial prompt request without payment proof...`);
  const unpaidRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Step 2 & 3: Receive and inspect HTTP 402
  console.log(`[Step 2] Received HTTP Status: ${unpaidRes.status} (Expected: 402 Payment Required)`);
  if (unpaidRes.status !== 402) {
    console.error(`Unexpected response status: ${unpaidRes.status}`);
    const body = await unpaidRes.text();
    console.error(`Response body: ${body}`);
    return;
  }

  const paymentRequiredHeader = unpaidRes.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    console.error("Missing 'Payment-Required' header in 402 response.");
    return;
  }

  const paymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader, "base64").toString("utf8")
  );
  console.log(`[Step 3] Payment Required Requirements:`);
  console.log(`- Resource:   ${paymentRequired.resource?.url}`);
  console.log(`- Scheme:     ${paymentRequired.accepts?.[0]?.scheme}`);
  console.log(`- Network:    ${paymentRequired.accepts?.[0]?.network}`);
  console.log(`- Amount:     ${paymentRequired.accepts?.[0]?.amount} base units (USDC)`);
  console.log(`- Asset ID:   ${paymentRequired.accepts?.[0]?.asset}`);
  console.log(`- PayTo:      ${paymentRequired.accepts?.[0]?.payTo}`);
  console.log(`- Challenge:  tag="${paymentRequired.accepts?.[0]?.extra?.tag}"`);

  // Step 4: Configure x402 Client with Algorand Signer
  const signer = getClientSigner();
  console.log(`\n[Step 4] Initialized Algorand client signer:`);
  console.log(`- Address: ${signer.address}`);

  const x402 = new x402Client().register("algorand:*", new ExactAvmScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, x402);

  // Step 5: Retry request with automatic x402 payment
  console.log(`\n[Step 5] Retrying request with x402 payment authorization...`);
  try {
    const paidRes = await fetchWithPay(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log(`[Step 6] Response Status: ${paidRes.status}`);

    const paymentResponseHeader = paidRes.headers.get("payment-response");
    if (paymentResponseHeader) {
      const settlement = decodePaymentResponseHeader(paymentResponseHeader) as any;
      const txId = settlement.txId || settlement.transactionId || settlement.transaction || settlement.transactionHash || "Confirmed";
      console.log(`[Step 6] Settlement Details:`);
      console.log(`- Settlement Success: ${settlement.success ?? true}`);
      console.log(`- Transaction ID:    ${txId}`);
      console.log(`- Explorer URL:      https://lora.algokit.io/testnet/transaction/${txId}`);
      console.log(`- Network:           ${settlement.network || "algorand"}`);
    } else {
      console.log(`[Step 6] Note: Payment-Response header was empty or processed in direct mode.`);
    }

    // Step 7: Print model response
    if (paidRes.ok) {
      const data = (await paidRes.json()) as any;
      console.log(`\n[Step 7] Model Media Response Received:`);
      if (modality === "chat") {
        console.log(`- Model:   ${data.model}`);
        console.log(`- Content: \n${data.choices?.[0]?.message?.content || "(empty content)"}`);
      } else if (modality === "image") {
        console.log(`- Images Generated: ${data.data?.length}`);
        console.log(`- URL: ${data.data?.[0]?.url}`);
        console.log(`- Revised Prompt: ${data.data?.[0]?.revised_prompt}`);
      } else if (modality === "voice") {
        console.log(`- Model: ${data.model} (${data.format})`);
        console.log(`- Audio URL: ${data.audio_url}`);
        console.log(`- Duration: ${data.duration_seconds}s`);
      } else if (modality === "video") {
        console.log(`- Model: ${data.model} (${data.aspect_ratio})`);
        console.log(`- Video URL: ${data.video_url}`);
        console.log(`- Duration: ${data.duration_seconds}s`);
      }
      console.log(`\nDemo completed successfully!\n`);
    } else {
      const errText = await paidRes.text();
      console.log(`Paid request response ${paidRes.status}: ${errText}`);
    }
  } catch (err: any) {
    console.error(`x402 payment authorization or settlement notice:`, err.message);
    console.log(`\nNote: If using an unfunded test signer on Testnet, ensure the account holds Testnet ALGO + USDC ASA 10458941.`);
  }
}

// Allow direct execution from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const modalityArg = args.find((a) => a.startsWith("--modality="))?.split("=")[1] as any;
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];
  const urlArg = args.find((a) => a.startsWith("--url="))?.split("=")[1];

  runTestClient({
    targetUrl: urlArg,
    modality: modalityArg,
    modelSlug: modelArg,
  }).catch(console.error);
}
