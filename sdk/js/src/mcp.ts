#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { createPublicClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toClientEvmSigner, PERMIT2_ADDRESS } from "@x402/evm";
import { agentKeyFromSecret, generateAgentKey, MoltworldClient, MoltworldError } from "./index.js";

const legacyAgentKeyFile = () => process.env.MOLTWORLD_AGENT_KEY_FILE || join(homedir(), ".moltworld", "agent.key");
const evmAgentKeyFile = () => join(homedir(), ".moltworld", "robinhood-agent.key");
const ROBINHOOD_RPC_URL = process.env.MOLTWORLD_EVM_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const erc20AllowanceAbi = [{
  type: "function",
  name: "allowance",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
} as const;

/** Legacy Algorand keygen; retained for the mandate rail. */
function keygen() {
  const file = legacyAgentKeyFile();
  if (existsSync(file)) {
    console.log(agentKeyFromSecret(readFileSync(file, "utf8").trim()).address);
    console.error(`Agent key already exists at ${file}.`);
    return;
  }
  const key = generateAgentKey();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, key.secretKeyB64 + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(key.address);
  console.error(`Agent key saved to ${file}. Give the owner the address above to bind a mandate to it.`);
}

/** Generate a dedicated Robinhood EVM key. Deliberately prints only its address. */
function evmKeygen() {
  const file = evmAgentKeyFile();
  if (existsSync(file)) {
    const secret = readFileSync(file, "utf8").trim() as `0x${string}`;
    console.log(privateKeyToAccount(secret).address);
    return;
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const secret = (`0x${Buffer.from(bytes).toString("hex")}`) as `0x${string}`;
  const account = privateKeyToAccount(secret);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, secret + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(account.address);
}

function evmPrivateKey(): `0x${string}` | undefined {
  const value = process.env.MOLTWORLD_EVM_PRIVATE_KEY?.trim() || (existsSync(evmAgentKeyFile()) ? readFileSync(evmAgentKeyFile(), "utf8").trim() : "");
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("MOLTWORLD_EVM_PRIVATE_KEY must be a 32-byte 0x-prefixed private key.");
  return value as `0x${string}`;
}

function clientFromEnv(): { client: MoltworldClient; robinhood: boolean } {
  const evmSecret = evmPrivateKey();
  if (evmSecret) {
    const account = privateKeyToAccount(evmSecret);
    const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(ROBINHOOD_RPC_URL) });
    const evmSigner = toClientEvmSigner(account);
    const client = new MoltworldClient({
      baseUrl: process.env.MOLTWORLD_URL || "https://motoworld-wif.vercel.app",
      evmSigner,
      maxPerRequestUsd: Number(process.env.MOLTWORLD_MAX_PER_REQUEST_USD ?? 0.5),
      budgetUsd: Number(process.env.MOLTWORLD_BUDGET_USD ?? 5),
      expectedPayTo: process.env.MOLTWORLD_PAYMENT_TO,
      ensureEvmAllowance: async ({ asset, amount }) => {
        const allowance = await publicClient.readContract({
          address: asset as Address,
          abi: erc20AllowanceAbi,
          functionName: "allowance",
          args: [account.address, PERMIT2_ADDRESS],
        });
        if (allowance < BigInt(amount)) {
          throw new Error(`Insufficient WIF Permit2 allowance (${allowance} < ${amount}). Approve Permit2 explicitly, then retry; no approval transaction is sent by this MCP server.`);
        }
      },
    });
    return { client, robinhood: true };
  }

  const mandate = process.env.MOLTWORLD_MANDATE
    ? JSON.parse(Buffer.from(process.env.MOLTWORLD_MANDATE, "base64").toString("utf8"))
    : undefined;
  const keyFile = legacyAgentKeyFile();
  return {
    robinhood: false,
    client: new MoltworldClient({
      baseUrl: process.env.MOLTWORLD_URL || "https://moltoworld.xyz",
      mandate,
      agentKey: mandate && existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined,
      mnemonic: mandate ? undefined : process.env.MOLTWORLD_MNEMONIC,
      maxPerRequestUsd: Number(process.env.MOLTWORLD_MAX_PER_REQUEST_USD ?? 0.5),
      budgetUsd: Number(process.env.MOLTWORLD_BUDGET_USD ?? 5),
    }),
  };
}

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown) => ({
  isError: true,
  ...json(err instanceof MoltworldError ? { status: err.status, code: err.code, message: err.message } : { message: String((err as any)?.message ?? err) }),
}) as ReturnType<typeof json> & { isError: true };

function paidSummary(result: Awaited<ReturnType<MoltworldClient["call"]>>, client: MoltworldClient) {
  return { output: result.data, paid_usdc: result.paidMicro / 1_000_000, receipt_verified: result.verification?.ok ?? false, request_id: result.requestId, txid: result.receipt?.txid, session_spent_usdc: client.spentUsd };
}

export async function main() {
  const { client, robinhood } = clientFromEnv();
  const server = new McpServer({ name: robinhood ? "moltworld-robinhood-wif" : "moltworld-wallet", version: "1.0.0" });
  const chatMessage = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() });

  server.registerTool("moltworld_models", {
    description: robinhood ? "List supported chat models and their WIF-paid from prices on Robinhood Chain." : "List available models with their 'from' price in USDC.",
    inputSchema: robinhood ? z.object({}) : z.object({ modality: z.enum(["chat", "image", "voice", "video"]).optional() }),
  }, async (input) => json(await client.models(robinhood ? "chat" : (input as any).modality)));

  server.registerTool("moltworld_quote", { description: robinhood ? "Exact WIF-priced chat request quote before signing." : "Exact price of a request before paying.", inputSchema: z.object({ model: z.string(), body: z.record(z.string(), z.unknown()) }) }, async ({ model, body }) => {
    try { return json(await client.quote(model, body)); } catch (err) { return failure(err); }
  });

  server.registerTool("moltworld_chat", {
    description: robinhood ? "Paid chat completion on Robinhood Chain using WIF and Permit2; signs only within local USD budget caps." : "Paid chat completion. Pays automatically in USDC within this server's spend limits; unused max_tokens budget is rebated.",
    inputSchema: z.object({ model: z.string(), messages: z.array(chatMessage).min(1), max_tokens: z.number().int().positive().optional() }),
  }, async ({ model, messages, max_tokens }) => {
    try { return json(paidSummary(await client.chat(model, { messages, max_tokens }), client)); } catch (err) { return failure(err); }
  });

  if (!robinhood) {
    server.registerTool("moltworld_image", { description: "Paid image generation (refunded if it fails).", inputSchema: z.object({ model: z.string(), prompt: z.string(), size: z.string().optional(), n: z.number().int().optional() }) }, async ({ model, prompt, size, n }) => {
      try { return json(paidSummary(await client.image(model, { prompt, size, n }), client)); } catch (err) { return failure(err); }
    });
    server.registerTool("moltworld_speech", { description: "Paid text-to-speech; returns base64 audio.", inputSchema: z.object({ model: z.string(), input: z.string(), voice: z.string().optional() }) }, async ({ model, input, voice }) => {
      try { return json(paidSummary(await client.speech(model, { input, voice }), client)); } catch (err) { return failure(err); }
    });
  }

  server.registerTool("moltworld_spend", { description: robinhood ? "Local USD budget and WIF wallet address; budget is local, not an on-chain cap." : "Wallet address and USDC spent in this session.", inputSchema: z.object({}) }, async () => json({ address: client.address, session_spent_usdc: client.spentUsd, budget_usdc: Number(process.env.MOLTWORLD_BUDGET_USD ?? 5), payment_chain: robinhood ? "robinhood" : undefined, chain_id: robinhood ? 4663 : undefined }));
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] === "keygen") keygen();
  else if (process.argv[2] === "evm-keygen") evmKeygen();
  else main().catch((err) => { console.error(err); process.exit(1); });
}
