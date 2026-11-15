# Developer ownership

## Developer 1 — Frontend (`apps/web`)

- Merchant UI: create/configure promotion, market selection, $5 offer, quote display, max YES
  price, budget, status dashboard.
- Customer UI: connect wallet, deposit mock tokens, escrow/hedge state, receipt, claim refund;
  merchant claim UI.
- Calls customer-signed instructions via `packages/solana`; reads off-chain status from `apps/api`.
- Mock data only as clearly marked fixtures. No server secrets in the browser.

## Developer 2 — Smart contracts **and** Solana infrastructure (`programs/escrow`, `packages/solana`)

- Anchor accounts, vault/escrow authority, instructions, events, state machine, tests, mock mint,
  deployment, IDL/program ID handoff.
- **Owns `packages/solana`:** PDA helpers, account fetches, tx builders, event decoders,
  QuickNode RPC/WSS subscriptions, deposit verification, replay/confirmation utilities, and
  server-only settlement/cancellation helpers.
- Does **not** choose acceptable Gemini quotes or manage Supabase business state. Backend hosts
  the long-lived worker; Dev 2 authors its Solana module.

## Developer 3 — Backend, Gemini, database (`apps/api`, `supabase/`)

- Read-only Gemini market mapping, quotes, staleness/liquidity checks, final-resolution lookup.
- Simulated hedge model (cost, size, partial/failed fills, settlement) and cap/budget policy.
- Supabase migrations, idempotent state transitions, API endpoints.
- Orchestration: verified deposit → simulated hedge; failure → `cancel_unhedged`; finalized
  outcome → `resolve_promo` (via Dev 2's package). Retries, checkpoints, reconciliation.
- Does **not** reimplement contract instructions or build a competing Solana SDK.
