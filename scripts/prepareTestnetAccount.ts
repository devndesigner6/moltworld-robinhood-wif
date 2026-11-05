import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { toClientAvmSigner } from "@x402/avm";
import { ed25519Generator } from "@algorandfoundation/algokit-utils/crypto";
import crypto from "crypto";

const TESTNET_USDC_ASA_ID = 10458941n;

export async function checkAndOptInAccount(privateKeyBase64?: string) {
  const sk = privateKeyBase64 || process.env.AVM_CLIENT_PRIVATE_KEY || process.env.AVM_PRIVATE_KEY;
  if (!sk) {
    console.error("No private key provided. Set AVM_CLIENT_PRIVATE_KEY or pass as argument.");
    process.exit(1);
  }

  const signer = toClientAvmSigner(sk);
  const client = AlgorandClient.testNet();

  console.log(`\n======================================================`);
  console.log(` Checking Algorand Testnet Account`);
  console.log(` Address: ${signer.address}`);
  console.log(` USDC ASA ID: ${TESTNET_USDC_ASA_ID}`);
  console.log(`======================================================\n`);

  try {
    const info = await client.account.getInformation(signer.address);
    const algoBalance = Number(info.amount) / 1e6;
    console.log(`- ALGO Balance: ${algoBalance.toFixed(4)} ALGO`);

    const usdcAsset = info.assets?.find((a: any) => BigInt(a.assetId) === TESTNET_USDC_ASA_ID);

    if (usdcAsset) {
      const usdcBalance = Number(usdcAsset.amount) / 1e6;
      console.log(`- USDC Status: OPTED IN`);
      console.log(`- USDC Balance: ${usdcBalance.toFixed(4)} USDC`);
      return { address: signer.address, algoBalance, optedIn: true, usdcBalance };
    }

    console.log(`- USDC Status: NOT OPTED IN`);

    if (algoBalance < 0.2) {
      console.log(`\n⚠️  Account requires at least 0.2 ALGO to opt-in to ASA ${TESTNET_USDC_ASA_ID}.`);
      console.log(`Please fund address: ${signer.address}`);
      return { address: signer.address, algoBalance, optedIn: false, usdcBalance: 0 };
    }

    console.log(`\nAccount has sufficient ALGO. Opting in to USDC ASA ${TESTNET_USDC_ASA_ID}...`);
    
    // Create Algorand account signer object for algokit
    const secretKeyBytes = Buffer.from(sk, "base64");
    const seed = secretKeyBytes.subarray(0, 32);
    const keypair = ed25519Generator(seed);

    const account = {
      addr: { toString: () => signer.address },
      signer: async (txns: any[], indexes: number[]) => {
        const rawSigned = await signer.signTransactions(txns, indexes);
        return rawSigned.filter((s: any) => s !== null);
      }
    };

    const res = await client.newGroup()
      .addAssetOptIn({
        sender: signer.address,
        assetId: TESTNET_USDC_ASA_ID,
        signer: (signer as any)._algokitSigner?.signer || (account as any).signer,
      })
      .send();

    console.log(`✅ Successfully opted in to USDC ASA ${TESTNET_USDC_ASA_ID}! TxID: ${res.txIds?.[0]}`);
    return { address: signer.address, algoBalance, optedIn: true, usdcBalance: 0 };
  } catch (err: any) {
    if (err?.message?.includes("404") || err?.message?.includes("not found")) {
      console.log(`\n⚠️  Account does not exist on Testnet yet (0 ALGO).`);
      console.log(`Please fund address: ${signer.address}`);
      return { address: signer.address, algoBalance: 0, optedIn: false, usdcBalance: 0 };
    }
    console.error("Error inspecting account:", err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argKey = process.argv[2];
  if (argKey === "--generate" || argKey === "-g") {
    const seed = crypto.randomBytes(32);
    const keypair = ed25519Generator(seed);
    const sk = Buffer.concat([seed, Buffer.from(keypair.ed25519Pubkey)]);
    const skB64 = sk.toString("base64");
    const signer = toClientAvmSigner(skB64);
    console.log(`\n======================================================`);
    console.log(` Generated Fresh Algorand Testnet Keypair`);
    console.log(` Address: ${signer.address}`);
    console.log(` AVM_CLIENT_PRIVATE_KEY=${skB64}`);
    console.log(`======================================================\n`);
  } else {
    checkAndOptInAccount(argKey).catch(console.error);
  }
}
