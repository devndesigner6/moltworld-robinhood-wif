/**
 * Deploys the mandate spend counter (src/mandates/counter.ts) and funds its account for
 * counter boxes. Prints the app id to set as MANDATE_COUNTER_APP_ID on the gateway.
 *
 *   DEPLOYER_KEY=<base64 64-byte key> ALGORAND_NETWORK=testnet pnpm mandate:counter
 *   ... ALGORAND_NETWORK=mainnet CONFIRM_MAINNET=yes pnpm mandate:counter
 *
 * The app is immutable (no update or delete path), so a deployment is permanent.
 */
import "dotenv/config";
import algosdk from "algosdk";
import { config } from "../src/config.js";
import { assembleCounter, assembleCounterClear, COUNTER_BOX_MBR_MICROALGO } from "../src/mandates/counter.js";

const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error("Set DEPLOYER_KEY to the base64 64-byte secret key of a funded account.");
if (config.isMainnet && process.env.CONFIRM_MAINNET !== "yes") throw new Error("Deploying on mainnet: set CONFIRM_MAINNET=yes.");

const sk = new Uint8Array(Buffer.from(key, "base64"));
const deployer = new algosdk.Address(sk.slice(32));
const algod = new algosdk.Algodv2(config.algodToken, config.algodUrl);
const boxes = Number(process.env.FUND_FOR_BOXES ?? 10);
const terms = { payTo: config.payToAddress, assetId: Number(config.usdcAsaId), minAmountMicro: Math.round(config.priceMinFloor * 1_000_000) };

const sp = await algod.getTransactionParams().do();
const create = algosdk.makeApplicationCreateTxnFromObject({
  sender: deployer,
  approvalProgram: assembleCounter(terms),
  clearProgram: assembleCounterClear(),
  numGlobalInts: 0,
  numGlobalByteSlices: 0,
  numLocalInts: 0,
  numLocalByteSlices: 0,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  suggestedParams: sp,
});
const { txid } = await algod.sendRawTransaction(create.signTxn(sk)).do();
const created = await algosdk.waitForConfirmation(algod, txid, 8);
const appId = Number(created.applicationIndex);
const appAddress = algosdk.getApplicationAddress(appId);

// Account minimum (0.1 ALGO) plus room for `boxes` mandate counters.
const funding = 100_000 + boxes * COUNTER_BOX_MBR_MICROALGO;
const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: deployer, receiver: appAddress, amount: funding, suggestedParams: sp });
await algosdk.waitForConfirmation(algod, (await algod.sendRawTransaction(fund.signTxn(sk)).do()).txid, 8);

console.log(JSON.stringify({ network: config.isMainnet ? "mainnet" : "testnet", appId, appAddress: appAddress.toString(), terms, fundedMicroAlgo: funding, createTxid: txid }, null, 2));
console.log(`\nSet MANDATE_COUNTER_APP_ID=${appId} on the gateway.`);
