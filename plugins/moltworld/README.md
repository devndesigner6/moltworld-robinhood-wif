# Moltworld plugin

Connects Claude Code, Codex and other MCP clients to Moltworld's remote MCP server at
`https://moltworld.xyz/mcp`. The `.codex-plugin` manifest is kept for Codex compatibility.

Remote tools (no wallet, nothing is ever paid by the server):

| Tool | What it does |
| --- | --- |
| `list_models` | Live catalog with each model's upstream and "from" price |
| `quote_request` | Exact USDC price for a request body, before paying |
| `get_payment_requirements` | The live HTTP 402 challenge for that body |
| `submit_signed_request` | Sends a request with a `Payment-Signature` your own wallet produced |
| `get_job` / `get_receipt` | Video job status, signed receipts, rebates and refunds |

## Letting an agent pay on its own

For autonomous use, run the local MCP server from the SDK. It signs payments itself, within
limits you set:

```json
{
  "mcpServers": {
    "moltworld-wallet": {
      "command": "npx",
      "args": ["-y", "-p", "moltworld-sdk", "moltworld-mcp"],
      "env": {
        "MOLTWORLD_MANDATE": "<base64 credential bound to this agent's key (moltworld-mcp keygen)>",
        "MOLTWORLD_MAX_PER_REQUEST_USD": "0.25",
        "MOLTWORLD_BUDGET_USD": "5"
      }
    }
  }
}
```

A mandate credential holds no private key. It is a delegated LogicSig that the Algorand
protocol only lets pay Moltworld, at most the per-call amount, until it expires. Moltworld also
enforces its daily cap and model allow-list, and the owner can revoke it at any time.

The service also publishes an A2A catalog agent at
`https://moltworld.xyz/.well-known/agent-card.json`, with JSON-RPC at `https://moltworld.xyz/a2a`.
