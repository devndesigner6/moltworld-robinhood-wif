import fs from "fs";
import path from "path";
import algosdk from "algosdk";
import dotenv from "dotenv";

dotenv.config();

const MAINNET_USDC_ASA_ID = 31566704;
const WALLET_FILE_PATH = path.resolve(process.cwd(), ".mainnet_merchant_wallet.json");
const MAINNET_ALGOD_URL = "https://mainnet-api.algonode.cloud";

export interface MerchantWalletData {
  address: string;
  mnemonic: string;
  privateKeyBase64: string;
  createdAt: string;
}

export function getOrCreateMerchantWallet(): MerchantWalletData {
  if (fs.existsSync(WALLET_FILE_PATH)) {
    const raw = fs.readFileSync(WALLET_FILE_PATH, "utf8");
    return JSON.parse(raw);
  }

  const account = algosdk.generateAccount();
  const address = account.addr.toString();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const privateKeyBase64 = Buffer.from(account.sk).toString("base64");

  const data: MerchantWalletData = {
    address,
    mnemonic,
    privateKeyBase64,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(WALLET_FILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}

export async function checkAndOptInMainnetMerchant() {
  console.log("======================================================================");
  console.log(" Moltworld — Algorand Mainnet Merchant Wallet Provisioning");
  console.log("======================================================================");

  const wallet = getOrCreateMerchantWallet();
  const algod = new algosdk.Algodv2("", MAINNET_ALGOD_URL, "");

  console.log(`\nMerchant Public Address:`);
  console.log(`>>> ${wallet.address} <<<\n`);
  console.log(`Network:          Algorand Mainnet`);
  console.log(`USDC Asset ID:    ${MAINNET_USDC_ASA_ID}`);
  console.log(`Explorer Link:    https://lora.algokit.io/mainnet/account/${wallet.address}`);
  console.log(`Local Keystore:   ${WALLET_FILE_PATH} (chmod 600, excluded from git)\n`);

  console.log("--- Account Status On Mainnet ---");
  try {
    const accountInfo = await algod.accountInformation(wallet.address).do();
    const algoBalance = Number(accountInfo.amount) / 1e6;
    console.log(`- ALGO Balance:   ${algoBalance.toFixed(4)} ALGO`);

    const assets: any[] = accountInfo.assets || [];
    const usdcAsset = assets.find((a) => Number(a.assetId || a["asset-id"]) === MAINNET_USDC_ASA_ID);

    if (usdcAsset) {
      const usdcBalance = Number(usdcAsset.amount) / 1e6;
      console.log(`- Mainnet USDC:   OPTED IN`);
      console.log(`- USDC Balance:   ${usdcBalance.toFixed(4)} USDC`);
      console.log(`\n🎉 Wallet is fully ready to receive Mainnet x402 payments!`);
      return { wallet, algoBalance, optedIn: true, usdcBalance };
    }

    console.log(`- Mainnet USDC:   NOT OPTED IN`);

    if (algoBalance < 0.25) {
      console.log(`\n⚠️  FUNDING REQUIRED:`);
      console.log(`Please send at least 0.5 to 1.0 ALGO to the merchant address:`);
      console.log(`  ${wallet.address}`);
      console.log(`\nThis covers the Algorand Minimum Balance Requirement (MBR) and the opt-in transaction fee.`);
      console.log(`Once funded, run: pnpm tsx scripts/manageMainnetMerchant.ts to complete the USDC opt-in.`);
      return { wallet, algoBalance, optedIn: false, usdcBalance: 0 };
    }

    // Account has sufficient ALGO -> Opt in to Mainnet USDC
    console.log(`\nAccount has ${algoBalance.toFixed(4)} ALGO. Opting in to Mainnet USDC ASA ${MAINNET_USDC_ASA_ID}...`);
    const skBytes = Buffer.from(wallet.privateKeyBase64, "base64");
    const params = await algod.getTransactionParams().do();

    const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: wallet.address,
      receiver: wallet.address,
      assetIndex: MAINNET_USDC_ASA_ID,
      amount: 0,
      suggestedParams: params,
    });

    const signedTxn = optInTxn.signTxn(skBytes);
    const sendResult = await algod.sendRawTransaction(signedTxn).do();
    const txId = sendResult.txId || sendResult.txid;

    console.log(`Submitted Opt-In TxID: ${txId}`);
    console.log("Waiting for confirmation on Algorand Mainnet...");

    await algosdk.waitForConfirmation(algod, txId, 4);
    console.log(`\n✅ Opt-in confirmed on Mainnet! TxID: ${txId}`);
    console.log(`Explorer: https://lora.algokit.io/mainnet/transaction/${txId}`);
    console.log(`Wallet is now ready to receive Mainnet USDC!`);

    return { wallet, algoBalance, optedIn: true, usdcBalance: 0 };
  } catch (err: any) {
    if (err.status === 404 || err.message?.includes("account does not exist")) {
      console.log(`- Status:         UNFUNDED (Not yet on-chain)`);
      console.log(`\n⚠️  FUNDING REQUIRED:`);
      console.log(`Please send at least 0.5 to 1.0 ALGO to:`);
      console.log(`  ${wallet.address}`);
      console.log(`\nThis will activate the account on Algorand Mainnet.`);
      console.log(`Once funded, run: pnpm tsx scripts/manageMainnetMerchant.ts to complete the USDC opt-in.`);
      return { wallet, algoBalance: 0, optedIn: false, usdcBalance: 0 };
    }
    console.error(`Error querying account info:`, err.message);
    throw err;
  }
}

// Execute when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkAndOptInMainnetMerchant().catch((err) => {
    console.error("Execution failed:", err);
    process.exit(1);
  });
}
