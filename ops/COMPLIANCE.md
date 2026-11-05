# Launch checklist: legal, tax and provider terms

This is a working checklist, not legal advice. Have a lawyer in your operating jurisdiction
review it before scaling paid mainnet traffic.

## Upstream provider terms

- [ ] **Resale.** Confirm OpenRouter, fal.ai, OpenAI and ElevenLabs terms allow serving their
      models to your own customers through an API, and any attribution they require.
- [ ] **Usage policies.** Moltworld passes prompts through; you remain responsible under each
      provider's usage policy. Decide whether to add input moderation for image and video.
- [ ] **Voice.** ElevenLabs voice ids may only be used as their terms permit.

## Payments and money transmission

- [ ] Moltworld sells a service for USDC. Confirm with counsel that this, the refunds and usage
      rebates, and especially the **marketplace payouts to third-party creators** do not make you
      a money transmitter or payment facilitator in your jurisdiction, or obtain the required
      registration.
- [ ] Sanctions screening: decide whether to screen payer and creator addresses.
- [ ] Creator onboarding: whether creators need KYC, and how you report payments to them (tax forms).

## Tax and accounting

- [ ] Revenue is recognised in USDC at settlement. Export `mw_requests` (completed, with txid),
      `mw_refunds` and `mw_payouts` monthly for bookkeeping.
- [ ] VAT/GST or sales tax on digital services may apply depending on buyer location, which an
      anonymous wallet does not reveal. Get advice on how to handle this.

## Customer terms

- [ ] Publish terms of service and a refund policy matching the system: chat is charged only
      after a successful answer and rebates unused tokens; image, voice and video are refunded on
      upstream failure; failed or expired video jobs are refunded.
- [ ] Privacy notice: prompts are forwarded to the listed upstream; Moltworld stores request and
      response bytes (up to 1 MB) for replay and receipts. Set a retention period and purge job.
- [ ] Marketplace creator agreement: content rules, review and suspension, fee (15%), payout
      threshold and timing.

## Security

- [ ] `AVM_ADDRESS` is cold or multisig; the payout wallet holds only a float.
- [ ] `RECEIPT_SIGNING_KEY` and `ADMIN_TOKEN` are backed up offline and rotated on staff change.
- [ ] Postgres backups (daily `pg_dump`, tested restore).
