import { serve } from "@hono/node-server";
import { app, init } from "./application.js";
import { assertProductionConfig, config } from "./config.js";
import { defaultModelRegistry } from "./models/registry.js";
import { scheduleCatalogSync } from "./models/sync.js";
import { startBackgroundWorkers } from "./workers/index.js";

async function main(): Promise<void> {
  assertProductionConfig();
  console.log("Initializing Moltworld x402 Gateway...");
  console.log(`- Network: ${config.isMainnet ? "MAINNET" : "TESTNET"} (${config.networkCaip2})`);
  console.log(`- Payment asset: ${config.paymentAssetSymbol} (${config.paymentAssetAddress})  payTo: ${config.payToAddress}`);
  console.log(`- Facilitator: ${config.facilitatorUrl}`);
  console.log(`- Ledger: ${config.databaseUrl ? "PostgreSQL" : "PGlite (in-process, development only)"}`);
  console.log(`- Mock providers: ${config.mockProviders}`);

  await init();
  scheduleCatalogSync(defaultModelRegistry);
  startBackgroundWorkers();

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Moltworld gateway listening on http://localhost:${info.port} (public: ${config.publicDomain})`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
