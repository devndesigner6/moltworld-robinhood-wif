import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 30000,
    testTimeout: 30000,
    exclude: ["node_modules", "dist"],
    env: {
      ALGORAND_NETWORK: "testnet",
    },
  },
});
