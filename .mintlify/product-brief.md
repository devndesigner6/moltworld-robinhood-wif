# Product brief

## Description
Moltworld is an x402 API gateway where a user or compatible client pays per eligible AI chat request in WIF on Robinhood Chain and receives the chat response with a signed receipt.

## Primary audience
AI-agent developers and API integrators building usage-based AI workflows. The person operating the integration may be an agent, but a human-controlled EVM wallet authorizes each live payment in the current product.

## Jobs to be done
- Discover the live chat models and request limits, then get a free quote for the exact request body.
- Make a chat call through the Playground, JavaScript/Python SDK, HTTP client, or MCP. The live WIF flow uses x402 and the payer's EVM wallet.
- Understand the Permit2 approval and Robinhood Chain gas requirements before approving a payment.
- Verify the signed receipt, exact WIF atomic amount, USD quote, and request/response hashes.
- Know which capabilities are not live on WIF, especially autonomous mandates, marketplace payouts, media endpoints, and automatic refunds.

## Motivation
The product offers a pay-per-request alternative to seat-based AI access and API-key billing, so a client can request a model call when a task needs it. The intended repeat-use loop is integration, useful chat request, user-authorized WIF payment, answer and receipt, then reuse on later tasks. WIF settlement is live for chat; the loop does not imply autonomous agent spending or marketplace payouts.

## Assumptions
The current documentation targets the Robinhood Chain mainnet WIF deployment and the World Is Flat Build hackathon. When a capability is still disabled, docs should preserve useful legacy context but label it clearly rather than imply it works on WIF. Mobile wallet support beyond injected wallets depends on a configured Reown project ID.
