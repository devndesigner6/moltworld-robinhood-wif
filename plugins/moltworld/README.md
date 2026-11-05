# Moltworld plugin

Connects Claude Code, Codex and other MCP clients to Moltworld's remote MCP server at
`https://motoworld-wif.vercel.app/mcp`. The `.codex-plugin` manifest is kept for Codex compatibility.

## Robinhood WIF remote tools

The Robinhood deployment is chat-only on chain ID `4663`:

| Tool | What it does |
| --- | --- |
| `list_models` | Chat-only catalog with WIF/USD from prices |
| `quote_request` | Exact USD quote before signing |
| `chat` | Relays a caller-signed WIF `Payment-Signature`; never signs or pays |
| `spend` | Describes the remote rail and local-budget model |

Images, speech, video, mandates, refunds, and marketplace are not live in Robinhood mode.

```json
{
  "mcpServers": {
    "moltworld": {
      "type": "streamable-http",
      "url": "https://motoworld-wif.vercel.app/mcp"
    }
  }
}
```

## Letting a local agent pay

Generate a dedicated Robinhood EVM key. Only its derived address is printed:

```bash
npx -y -p moltworld-sdk moltworld-mcp evm-keygen
```

Then run the local stdio server with local USD limits:

```json
{
  "mcpServers": {
    "moltworld-wallet": {
      "command": "npx",
      "args": ["-y", "-p", "moltworld-sdk", "moltworld-mcp"],
      "env": {
        "MOLTWORLD_URL": "https://motoworld-wif.vercel.app",
        "MOLTWORLD_MAX_PER_REQUEST_USD": "0.25",
        "MOLTWORLD_BUDGET_USD": "5"
      }
    }
  }
}
```

The local server reads `~/.moltworld/robinhood-agent.key` (mode `0600`) or
`MOLTWORLD_EVM_PRIVATE_KEY`, uses the existing JavaScript SDK EVM client, validates the
gateway `paymentTo`, and enforces local USD caps before signing. It checks the WIF ERC-20
allowance to Permit2 with read-only RPC and refuses before signing when insufficient. It
never broadcasts an approval; approve the exact amount to Permit2 explicitly, with native
ETH available for gas.

The legacy Algorand mandate/mnemonic mode remains available when no EVM key is configured.
