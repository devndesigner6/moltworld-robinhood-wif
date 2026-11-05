import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import algosdk from "algosdk";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "net";
import { Harness, startHarness } from "./helpers/harness.js";
import { createMandate, generateAgentKey } from "../sdk/js/src/index.js";

let harness: Harness;
let server: ReturnType<typeof serve>;
let gatewayUrl = "";

function hasPythonSdkDeps(): boolean {
  try {
    execFileSync("python3", ["-c", "import algosdk, nacl"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  harness = await startHarness();
  process.env.FACILITATOR_URL = harness.facilitatorUrl;
  process.env.ALGOD_URL = harness.algodUrl;
  process.env.MANDATE_COUNTER_APP_ID = "4242";
  const mod = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  harness.chain.counter = { appId: 4242, payTo: config.payToAddress, assetId: Number(config.usdcAsaId), minAmountMicro: Math.round(config.priceMinFloor * 1_000_000), boxes: new Map() };
  await mod.init();
  await new Promise<void>((resolve) => {
    server = serve({ fetch: mod.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      gatewayUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  server?.close();
  await harness?.close();
});

describe("Python SDK interop", () => {
  it("builds payments the reference facilitator accepts and verifies receipts", async (ctx) => {
    if (!hasPythonSdkDeps()) return ctx.skip();
    const payer = algosdk.generateAccount();
    harness.chain.balances.set(payer.addr.toString(), 2_000_000);
    // A capped mandate bound to an agent key, created with the TypeScript SDK, paid from Python.
    const owner = algosdk.generateAccount();
    harness.chain.balances.set(owner.addr.toString(), 2_000_000);
    const agent = generateAgentKey();
    const { credential } = await createMandate(gatewayUrl, owner, { agent: agent.address, maxPerCallUsd: 0.5, dailyCapUsd: 1, algodUrl: harness.algodUrl });
    // Async spawn: the gateway under test runs in this process and must keep serving.
    const { stdout: output } = await execFileAsync("python3", ["tests/interop/python_client.py"], {
      env: {
        ...process.env,
        GATEWAY_URL: gatewayUrl,
        ALGOD_URL: harness.algodUrl,
        PAYER_SK: Buffer.from(payer.sk).toString("base64"),
        MANDATE: Buffer.from(JSON.stringify(credential)).toString("base64"),
        AGENT_SK: agent.secretKeyB64,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    const result = JSON.parse(output.trim().split("\n").pop()!);
    expect(result.address).toBe(payer.addr.toString());
    expect(result.verified).toBe(true);
    expect(result.paid_micro).toBe(result.quote_micro);
    expect(result.payer).toBe(payer.addr.toString());
    expect(harness.chain.settled.some((s) => s.txid === result.txid && s.from === payer.addr.toString())).toBe(true);
    expect(result.content).toContain("Grüße");
    expect(result.cap_enforced).toBe(true);
    // Under the mandate: the credential alone is refused; with the agent's key it pays as the owner,
    // through the spend counter.
    expect(result.credential_alone_refused).toBe(true);
    expect(result.mandate_payer).toBe(owner.addr.toString());
    expect(result.mandate_verified).toBe(true);
    expect(harness.chain.settled.some((s) => s.txid === result.mandate_txid && s.lsig)).toBe(true);
    expect([...harness.chain.counter!.boxes.values()].some((b) => b.spent === result.mandate_paid)).toBe(true);
  });
});
