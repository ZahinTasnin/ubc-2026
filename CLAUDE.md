# CLAUDE.md — Hedged Refund Promotions

> Instructions for Claude Code and all contributors. This is a **simulation-first Solana hackathon MVP**, not a live payment or prediction-market trading service.
>
> Source of truth for product scope: `Full idea(1).docx` (concept and MVP specification) and `MVP Technical(1).docx` (architecture and workflow diagrams), supplied by the project team on November 15, 2026. If those files are copied into the repo, keep them in `docs/reference/`. This file translates their requirements into development guidance; do not silently introduce new product requirements.

## 1. What we are building

A merchant can offer a conditional refund, such as **“Buy a $5 coffee; if Texas wins, get your $5 back.”** Customers deposit a mock USD stablecoin into an Anchor-controlled Solana escrow. Our backend observes confirmed deposits through QuickNode, retrieves **live read-only Gemini Predictions** market data, and **simulates** buying sufficient YES contracts to offset the merchant's refund obligation. Once the relevant market is officially resolved, an authorized backend relayer reports the final outcome to the Anchor program. If Texas wins, the customer can claim the escrowed tokens; otherwise, the merchant can claim them.

**Economic example (illustrative, not a guaranteed actual fill):** At a YES price of $0.34 for a $1 payout, a $5 purchase implies five contracts and a $1.70 simulated premium. For $1,000 of purchases, the theoretical premium is $340 and merchant retained sales cash is $660 under either outcome, **before** merchandise costs, spreads, fees, taxes, slippage and mismatch. This is not $660 profit; no real hedge is bought in the MVP.

**Demo success:** Show a Texas-win and Texas-loss flow, readable quotes and simulated hedge states, and independently verifiable Devnet token movement/purchase accounts. Also demonstrate a hedge-failure refund path.

## 2. Non-negotiable MVP boundaries

- **Solana Devnet only**; mock USD SPL stablecoin (6 decimals). All tokens are valueless test tokens. Customers and merchants **already have Solana wallets** and Devnet SOL for fees. No wallet onboarding, fiat on/off-ramping or POS integration.
- **Anchor/Rust** for on-chain escrow; Solana SPL Token Program and token accounts/ATAs. No EVM code, ERC-4337, or Ethereum account abstraction.
- **Gemini Predictions is READ ONLY.** Use live market data and, where exposed and verified, *official final market settlement status*. **Never place real orders, create real financial positions, or transfer real Gemini/merchant money.** Simulated orders, premiums, partial fills, failures, and payouts live in the off-chain ledger and are labeled as such.
- The **Solana ledger and simulated Gemini ledger are separate**. No bridging, foreign-exchange conversion, real Gemini account balance, or direct payout from Gemini to a Solana wallet.
- **QuickNode** supplies Solana RPC, account/transaction lookups, and deposit event delivery (Streams or WebSocket fallback). It is **not** an outcome oracle and does not execute Gemini hedges.
- **Backend is a trusted MVP relayer.** It checks the relevant Gemini market's final official outcome, validates market identity, and invokes authorized on-chain settlement. If the required finalized outcome is not available via API, **do not fabricate it**: leave settlement pending or use a clearly labeled manual demo-only fixture.
- Don't treat market price ~0 or ~1, a live score, a trading WebSocket update, or an unconfirmed result as official settlement.
- No formal decentralized oracle/dispute system, production governance, real-money custody, KYC/AML, or regulatory compliance implementation for the MVP. These remain production launch blockers, not resolved assumptions.
- Never represent **simulated** hedge results as real fills or promise guaranteed merchant profits.

## 3. Technology and repo layout

Use a minimal **pnpm + TypeScript monorepo** where possible, with independent Anchor/Cargo tooling:

```text
apps/
  web/                      # Dev 1 — Next.js, TypeScript, Tailwind, Solana wallet UI
  api/                      # Dev 3 — Node.js/TypeScript API and hedge worker
programs/
  escrow/                   # Dev 2 — Anchor/Rust escrow program
packages/
  solana/                   # Dev 2 — reusable Solana client, event decoder, tx helpers
  shared/                   # shared DTOs, statuses, monetary conventions
supabase/
  migrations/               # Dev 3 — PostgreSQL migrations
tests/                       # integration and scenario tests
docs/
  architecture.md
  interfaces.md
  workflow.md
  setup.md
  developer-ownership.md
.env.example
.gitignore
package.json
pnpm-workspace.yaml
Anchor.toml
Cargo.toml
README.md
CLAUDE.md
```

Recommended tooling: **Next.js App Router**, TypeScript, Tailwind, compatible Solana wallet adapter packages, **Node.js + TypeScript** backend (Fastify is a reasonable default), **Supabase PostgreSQL**, **Anchor**, QuickNode Solana Devnet RPC/Streams or WSS, Gemini Predictions read-only endpoints. Confirm actual installed tool versions and dependency compatibility before choosing versions. Do not assume an API path, Gemini event type, or SDK method exists without verifying its documentation or available API responses.

## 4. Developer ownership — avoid ambiguous handoffs

### Developer 1 — Frontend

- Merchant UI: create/configure promotion, event/market selection, $5 offer, quote display, max acceptable YES price, budget, and status/dashboard.
- Customer UI: connect Solana wallet, submit mock-token deposit, show escrow/hedge state, receipt, claim refund; merchant claim UI.
- Calls customer-signed Anchor instructions through `packages/solana` and queries `apps/api` for off-chain status.
- Mock API responses are allowed **only when clearly marked fixtures**. No server secrets or privileged signing keys in browser bundles.

### Developer 2 — Smart contracts **and Solana infrastructure** (project owner)

- Anchor promo/purchase PDA schemas, escrow authority/vault token accounts, token transfers, signer/mint constraints, state transitions, one-time claims, deadlines and pause/recovery safeguards.
- Anchor instructions and events, tests (local validator and Devnet as appropriate), mock mint setup, program deployment, IDL/program ID handoff.
- Own `packages/solana`: PDA helpers, account fetches, transaction builders, Anchor event decoders, QuickNode RPC/WSS event subscriptions, transaction verification, confirmation/replay utilities.
- Expose **reusable typed utilities** to Dev 1/3, including server-only helpers for authorized settlement and cancellation. Dev 2 does **not** decide which Gemini quote is acceptable or manage Supabase business state.
- Backend still **hosts and runs** any long-lived event subscriber/worker; Dev 2 authors its Solana integration module.

### Developer 3 — Backend, Gemini and database

- Read-only Gemini market mapping, quote/order-book retrieval, staleness/liquidity checks, final resolution lookup, and gracefully handling unavailable APIs.
- Explicit virtual hedge simulation (cost, size, availability, partial/failed fills, settlement) and merchant cap/budget policy.
- Supabase migrations and idempotent purchase/hedge/outcome state transitions; API endpoints consumed by frontend.
- Orchestrate verified deposit -> simulated hedge, failure -> `cancel_unhedged`, and finalized outcome -> `resolve_promo`, using Dev 2's Solana package.
- Own retries, checkpointed processing, reconciliation, and avoiding duplicate simulated hedges. Developer 3 does **not** reimplement smart-contract instructions or write a competing Solana SDK.

**Interfaces to coordinate before coding:** Anchor IDL and PDA seed conventions; `DepositEvent` fields; authority/signing model; token mint/decimals; purchase IDs and promo-to-Gemini market mapping; backend route DTOs; on-chain vs database status mappings.

## 5. End-to-end workflow

1. Merchant chooses an existing Gemini market/event, promo price, deadline, max hedge quote, and budget.
2. Customer connects a Solana wallet, authorizes transfer of **5 mock stablecoins** from customer ATA into program-controlled escrow, and gets a purchase PDA.
3. Anchor emits a deposit event; QuickNode makes the transaction/log available. Backend independently verifies success, actual account/mint/amount and chosen finality before processing.
4. Backend retrieves the **real** Gemini quote/order book and computes a **hypothetical** number of $1-payout YES contracts and premium using available depth and explicitly modeled assumptions.
5. If cap/budget/freshness/liquidity rules pass, record simulated hedge (and optionally mark purchase hedged via authorized Anchor instruction). Do **not** call any Gemini order-placement endpoint.
6. If the quote is too high/stale, liquidity insufficient, a fill cannot be simulated, or Gemini is unavailable: mark `HEDGE_FAILED`, pause new checkout as appropriate, and initiate `cancel_unhedged` after applicable policy/deadline; refund **full mock deposit** to original customer ATA. Do **not** fulfill product before hedge acceptance in the demo checkout flow.
7. On event end, backend checks the **officially finalized** settlement outcome from Gemini for the **exact** market used by the promotion. Relayer signs `resolve_promo` once. If no reliable final outcome is available, hold funds and signal pending/admin recovery.
8. Customer claims escrow tokens on YES; merchant claims escrow tokens on NO. Settle simulated Gemini position in database only; it does not transfer real funds.

### Failure and non-atomicity policy

The Solana deposit and the off-chain Gemini data/simulation **cannot be atomic**. `PENDING_HEDGE -> HEDGED | HEDGE_FAILED`; failure is a **refund/unwind**, never a fictitious successful hedge. Handle partial simulated fills as **not fully covered**: bounded retry or cancel. Idempotent event handling is mandatory. Do not set a database status to `REFUNDED` until on-chain refund is verified.

## 6. Proposed Anchor contract — design spec, not finished code

**Accounts**

- `Promo` PDA: merchant, relevant Gemini market/outcome identifier, offer value/accepted mint, deadline, caps/budget/rules, authorized relayer and promotion state.
- `Purchase` PDA: unique purchase identifier, customer, promotion, amount, escrow state, hedge-acceptance/eligibility indicator (if mirrored on-chain), claim/cancel flag.
- Program-controlled SPL vault (per-promo or per-purchase; choose and document). If shared, maintain exact per-purchase liabilities and token conservation. Customer/merchant ATAs must match the required mint.

**Instructions (use naming from the supplied concept document):**

| Instruction | Intended action | Authority |
|---|---|---|
| `initialize_promo` | Create promotion and rules | Merchant / authorized initializer |
| `deposit` | Lock customer's SPL stablecoins, create purchase, emit event | Customer |
| `mark_hedged` | Record that off-chain hedge simulation succeeded; unlock eligibility | Authorized relayer |
| `cancel_unhedged` | Cancel ineligible/unhedged purchase and return deposit | Authorized cancellation path / policy |
| `resolve_promo` | Set officially resolved YES/NO outcome exactly once | Authorized outcome relayer |
| `claim_refund` | Return purchase amount to customer upon YES | Customer or permitted claimant |
| `claim_merchant` | Transfer eligible purchase amount to merchant upon NO | Merchant or permitted claimant |

Build an explicit transition/authorization matrix before coding. Prevent unauthorized cancellation of hedged purchases, double claims, wrong mint/account substitution, deposits after expiry, invalid or conflicting resolution, and draining funds belonging to other purchases. Include emergency pause or recovery controls scoped to the MVP; do not silently grant an admin arbitrary withdrawal rights.

**Events** (proposed): `DepositEvent { purchase, promo, customer, amount }`, `PromotionResolvedEvent`, `PurchaseCancelledEvent`, optionally `PurchaseHedgedEvent`. Prefer integer token base units (`5 USDC = 5_000_000` with 6 decimals), not floating-point value accounting.

**Important source nuance:** The supplied concept calls for `mark_hedged` and `cancel_unhedged`. Earlier informal planning used `cancel_purchase`; use the source-document names by default and avoid generating two overlapping cancellation instructions. If `mark_hedged` does not belong on-chain, propose and document that simplification **before** removing it, because its role in authorizing merchant settlement must be understood.

## 7. QuickNode + Solana client boundary

- QuickNode RPC is for transaction submission/reads; Streams or WebSocket logs for event delivery. The on-chain program **emits logs/events**; it does not call QuickNode HTTP APIs itself.
- `packages/solana` should provide typed helpers such as `derivePromoPda`, `derivePurchasePda`, `getPurchaseState`, `verifyDeposit`, `subscribeToDeposits`, `buildDepositTransaction`, `resolvePromotion`, and `cancelUnhedged` (exact names can evolve together with documented interfaces).
- Split wallet/browser-safe utilities from **server-only** signing/event infrastructure. Do not import relayer keys into web UI.
- Independently validate event signatures, program ID, finalized status, mint, accounts, amounts, matching promotion/purchase and event position. Deduplicate by `(transaction signature, event index)`; replay missing slots/checkpoints after disconnects. A WebSocket notification alone is not durable finality.
- Developer 3 subscribes to verified notifications from this package; they own application-level hedge/cancellation logic.

## 8. Gemini data + simulation

- Source says **Rachel has a Gemini account**, but this does **not** prove usable API permissions, market coverage or live settlement endpoints. Confirm credentials/permissions, allowed data usage, exact market IDs, read-only methods, and rate limits before wiring real data.
- Live quotes must have source, timestamp, market identifier, ask/depth or explicitly labeled model assumptions; do not invent prices when live data fails.
- Simulation should capture `market_id`, `purchase_id`, requested YES contract quantity, quote, assumed fill quantity/price, premium, status, and eventual virtual payout. Simulate insufficient liquidity and partial/failure states.
- **No real placement, authenticated trade endpoints, orders, deposits or withdrawals.** Credentialed read-only endpoints, if needed, must be backend-only.
- Resolve only once official Gemini market-finality information is available. Backend relayer is responsible for mapping that outcome to Anchor YES/NO. If official settlement endpoint details are unverified, leave TODO rather than inventing a webhook or endpoint.

## 9. Database, API and lifecycle

Suggested Supabase tables: `promotions`, `purchases`, `simulated_hedges`, `market_quotes`, `market_outcomes`, plus processing checkpoints if necessary. Store Solana public keys as strings, market IDs, transaction signatures, confirmation state, status timestamps, and a unique deposit event identifier. Keep explicit simulated money units; use integer base units / decimal-safe arithmetic.

**Database orchestration statuses (illustrative):**

`DEPOSITED -> PENDING_HEDGE -> HEDGED -> RESOLVED -> CLAIMED`

or

`DEPOSITED -> PENDING_HEDGE -> HEDGE_FAILED -> CANCEL_PENDING -> REFUNDED`

Not all of these statuses are on-chain; **on-chain vault and Purchase account are authoritative for escrow**. Database is a derived operational record. Supabase writes, Gemini reads, and Solana transactions must be reconciled and retried safely; they are not one transaction.

Proposed API surface (contracts first; do not return simulated data as live):

- `GET /health`
- `GET /api/markets`
- `GET /api/markets/:id/quote`
- `POST /api/promotions`
- `GET /api/promotions/:id`
- `GET /api/purchases/:id`
- `GET /api/merchants/:id/dashboard`

Avoid trusting client-submitted `HEDGED`, `REFUNDED`, win/loss outcome, or Gemini price fields. Require proper access controls before exposing user/merchant records.

## 10. Security, correctness and testing

- All on-chain transfers must check expected mint, signer, PDA seeds, owners, account associations and exact amounts; use appropriate checked SPL transfer semantics. Close or reclaim accounts only under explicit safe conditions.
- Enforce one-time resolution, cancellation restrictions, exactly-one refund/merchant claim per purchase, and conservation of escrow liabilities.
- Never commit actual `.env` files, Gemini secrets, RPC keys, Supabase service-role keys, or relayer keypairs. Provide `.env.example`; do not expose server-only values through `NEXT_PUBLIC_*`.
- Wait for the chosen Solana finality/confirmation threshold and verify the fetched transaction/account state. Maintain reconciliation for chain reorgs, dropped WebSocket notifications and worker restarts.
- Test: YES payout to customer; NO payout to merchant; quote-over-cap failure and refund; unavailable Gemini quote; partial hypothetical fill; stale quote; double claim; wrong signer/mint/ATA; duplicate/reordered events; repeated resolution; deadline expiry; failed relayer submission; vault balance conservation.
- Explicitly distinguish **real on-chain test transfers** from **simulated off-chain hedge executions** in dashboards, logs, and demos.

## 11. Milestones and division of integration

1. **M1 — On-chain:** Anchor program, mock mint, deposit, escrow and claims, local validator tests (Dev 2).
2. **M2 — Ingestion:** QuickNode Devnet RPC/Streams or WSS, verified deposits, dedupe and replay (Dev 2 module; Dev 3 worker hosting).
3. **M3 — Hedge model:** Read-only Gemini adapter, explicit virtual fills, caps and exposure (Dev 3).
4. **M4 — Settlement:** Gemini finalized outcome mapping, trusted relayer, Anchor resolve, win/loss tests (Devs 2 + 3).
5. **M5 — Experience:** Merchant dashboard, customer checkout, receipts, claims, polished economics demo (Dev 1, everyone integration testing).

All developers may work in parallel once type/schema/IDL/API interfaces are agreed. Start frontend with **clearly marked mock fixtures**; backend with stubbed Solana adapters; contract code with local validator tests. Do not block independent work on a deployed Devnet program.

## 12. Guidance for Claude Code in this repo

1. **Inspect the repository before editing.** Preserve existing implementations and avoid rewriting unrelated files.
2. **Ask which developer/module is being implemented when scope is ambiguous.** If scaffolding the repo, create only minimal runnable apps, Anchor workspace, shared types, specs, scripts and `.env.example`, not a complete product.
3. **Prefer small, verifiable changes.** Keep modules under the owners above; avoid putting application business logic into the Anchor SDK or chain-level signing logic into the Gemini service.
4. **Do not fabricate integration success.** Check API docs and package compatibility; if external services/credentials are missing, use explicit TODOs and labeled demo fixtures. Do not silently substitute fake market prices or outcomes.
5. **Run applicable tests, typechecks, lint, and builds** after changes. Report commands run, results, blockers, and any tests not executed.
6. **No real-money or mainnet operations.** Never send authenticated Gemini trade requests, use live funding, or deploy to Solana mainnet without a separate explicit product/design decision.
7. **Never auto-commit, push, deploy or overwrite credentials** unless specifically requested.
8. Keep `README.md`, `docs/interfaces.md` and shared DTOs synchronized with any change to Anchor instructions, events, PDA seeds, API shape or status lifecycle.

## 13. Deferred production questions — do not solve as MVP features

- Whether to retain Solana-native checkout or add cards/Apple Pay, embedded wallets, sponsored gas, fiat on-ramps and off-ramps.
- Whether merchant obtains a licensed/authorized trading account and who may trade/hold funds.
- Legal seller, escrow custodian, authorized trader, promotional obligor; jurisdictional eligibility, promotional/consumer disclosures, custody, KYC/AML and money transmission.
- Exchange liquidity, real fill/slippage, capital funding, settlement currency mismatches, reconciliation of actual proceeds, fees and merchant economics.
- Robust outcome attestation and correction/finality policy, challenge/dispute window, governance/rotation of trusted signer(s), production recovery.

**Bottom line:** Build a demonstrable, auditable *simulation* of on-chain conditional refunds + off-chain prediction-market-informed hedge accounting. Keep every simulated execution clearly distinguished from actual chain transactions and Gemini market data.
