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
- **Backend is a trusted MVP relayer** (Dev 4 decides when to settle; Dev 3's helpers sign and submit). It checks the relevant Gemini market's final official outcome, validates market identity, and invokes authorized on-chain settlement. If the required finalized outcome is not available via API, **do not fabricate it**: leave settlement pending or use a clearly labeled manual demo-only fixture.
- Don't treat market price ~0 or ~1, a live score, a trading WebSocket update, or an unconfirmed result as official settlement.
- No formal decentralized oracle/dispute system, production governance, real-money custody, KYC/AML, or regulatory compliance implementation for the MVP. These remain production launch blockers, not resolved assumptions.
- Never represent **simulated** hedge results as real fills or promise guaranteed merchant profits.

## 3. Technology and repo layout

Use a minimal **pnpm + TypeScript monorepo** where possible, with independent Anchor/Cargo tooling:

```text
apps/
  web/                      # Dev 1 — Next.js, TypeScript, Tailwind, Solana wallet UI
  api/                      # Dev 4 — Node.js/TypeScript API, Gemini adapter, hedge worker
programs/
  escrow/                   # Dev 2 — Anchor/Rust escrow program
    idl/                    # Dev 2 — committed IDL/types export consumed by packages/solana
packages/
  solana/                   # Dev 3 — Solana SDK, QuickNode listeners, event decoder, tx/relayer helpers
  shared/                   # shared DTOs, statuses, monetary conventions, SolanaServerGateway (PR needs affected owners)
supabase/
  migrations/               # Dev 4 — PostgreSQL migrations
tests/                       # integration and scenario tests
docs/
  architecture.md
  interfaces.md
  workflow.md               # flows, state machines, race analysis
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

## 4. Developer ownership — four developers, avoid ambiguous handoffs

Each developer works on their own branch and edits only their own paths; changes elsewhere go via the owner's review. Details: `docs/developer-ownership.md`.

### Developer 1 — Frontend (`apps/web`) — Next.js, TypeScript, Wallet Adapter

- Merchant dashboard: create/configure promotions, market selection, $5 offer, quote display, max acceptable YES price, budget, purchases and simulated-hedge status.
- Customer checkout: wallet connection, mock-USDC deposit, escrow/hedge state, receipt; customer refund and merchant claim UIs.
- Uses `@hedged/solana` (browser-safe entry only) for PDAs, state reads and unsigned transaction builders; uses `apps/api` REST for off-chain status. Never imports `@hedged/solana/server`.
- Mock API responses are allowed **only when clearly marked fixtures**. No server secrets or privileged signing keys in browser bundles.

### Developer 2 — Smart contracts (`programs/escrow`) — Anchor, Rust, SPL Token

- Promo/Purchase PDAs, escrow vault token accounts, authorization, accounting, token transfers, signer/mint constraints, state transitions.
- Instructions: `initialize_config`, `set_paused`, `set_relayer`, `initialize_promo`, `deposit`, `mark_hedged`, `cancel_unhedged` (the single cancellation instruction; it creates a refund entitlement), `resolve_promo`, `claim_refund`, `claim_merchant`. Authority/pause matrix: `docs/interfaces.md` §2.
- Enforces one-time resolution, authorized relayer, emergency pause, double-claim prevention, deadlines.
- Defines and emits `DepositEvent`, `HedgeMarkedEvent`, `PurchaseCancelledEvent`, `ResolutionEvent`, `ClaimEvent` (§6).
- Exports Anchor IDL (`programs/escrow/idl/`), program ID, account schemas and PDA-derivation documentation; writes Anchor tests; creates the mock mint; deploys to Devnet.
- **Boundary:** on-chain program logic only — not QuickNode infrastructure or the off-chain Solana SDK.

### Developer 3 — Solana infrastructure (`packages/solana`) — QuickNode, web3.js, Anchor TS client

- QuickNode RPC/WebSocket (or Streams) configuration; listeners for deposit and resolution events; Anchor event decoding from the IDL.
- Verifies transaction signatures, token transfers, program ID, mint/accounts/amounts, and confirmation/finality before surfacing anything.
- Event deduplication `(signature, eventIndex)`, retries, WebSocket reconnection, checkpoint replay.
- Reusable SDK: PDA helpers, state reads, browser-safe transaction builders, and server-only settlement/cancellation helpers (`markHedged`, `cancelUnhedged`, `resolvePromotion`). Privileged relayer signing stays server-side; the key is injected by the host process.
- Implements `SolanaServerGateway` (`packages/shared`) for Dev 4. Must be developable/testable on its own against localnet/Devnet with no backend or DB.
- **Boundary:** off-chain Solana integration only — not Rust contract logic, Gemini, or Supabase business state.

### Developer 4 — Backend + Gemini (`apps/api`, `supabase/migrations`) — Node.js, TypeScript, Supabase

- Read-only Gemini market mapping, quotes/order book, staleness/liquidity checks, finalized outcome lookup, graceful handling of unavailable APIs.
- Simulated hedge model (cost, size, partial/failed fills, premiums, positions, payouts) and merchant cap/budget policy. No real Gemini trades.
- Supabase schema, purchase/hedge state machine, REST APIs consumed by Dev 1.
- Consumes verified deposits through `SolanaServerGateway`; on hedge failure calls `cancelUnhedged`; at event end fetches the finalized outcome and calls `resolvePromotion`.
- Owns workers, idempotent processing, retries, checkpoint persistence, and reconciliation; hosts Dev 3's long-lived listener.
- **Boundary:** no Solana-specific logic (no raw instruction building, event decoding, or competing SDK) and no on-chain logic.

### Interface contracts to agree before coding

1. **Dev 1 ↔ Dev 2:** IDL, PDA seeds, wallet-signed instructions/accounts, token decimals, mint, fee payer.
2. **Dev 2 ↔ Dev 3:** events, account schemas, instruction interfaces, relayer/cancellation authority, IDL consumption and change notice.
3. **Dev 3 ↔ Dev 4:** `SolanaServerGateway`: verified deposit/resolution notifications, confirmation semantics, settlement/refund helpers.
4. **Dev 4 ↔ Dev 1:** REST routes and DTOs, promotion configuration, purchase/hedge status, outcome data.

**Decided** (see `docs/interfaces.md`): PDA seeds, vault model, `purchase_id` format, event schemas, authority/pause matrix, gateway interface, on-chain vs database status mapping. **Still open:** REST DTOs, Gemini market-id mapping details, and the business rules in `docs/interfaces.md` §8. Record agreed items in `docs/interfaces.md` and `packages/shared`.

### Dependency rules (no cycles)

`packages/shared` imports nothing in the workspace. `packages/solana` imports only `@hedged/shared`. `apps/api` imports `@hedged/shared` and `@hedged/solana/server`. `apps/web` imports `@hedged/shared` and `@hedged/solana` (never `/server`). Nothing imports from `apps/*`. Dev 4 may develop against a clearly labeled fake `SolanaServerGateway`.

## 5. End-to-end workflow

Diagrams and transition tables: `docs/workflow.md`.

1. Merchant chooses an existing Gemini market/event, promo price, deadline, max hedge quote, and budget (max price/budget are off-chain; the Promo PDA stores merchant, mint, offer amount, deadline and exact market id).
2. Customer connects a Solana wallet and signs `deposit` of **5 mock stablecoins** (customer ATA → the promotion vault) with a client-generated `purchase_id`; a Purchase PDA (`Deposited`) is created and `DepositEvent` emitted.
3. Dev 3's infra detects the event via QuickNode and **verifies the finalized transaction and account/token state** (events are notifications, not proof) before notifying the backend.
4. Backend records the purchase idempotently, retrieves the **real** Gemini quote/order book and computes a **hypothetical** number of $1-payout YES contracts and premium using available depth and explicitly modeled assumptions.
5. If cap/budget/freshness/liquidity rules pass, the backend **persists the simulated hedge once** (unique per purchase) → `HEDGE_SIMULATED`, then calls `gateway.markHedged`. The gateway builds and submits the relayer-signed `mark_hedged`; Anchor checks relayer authority and moves the purchase to `Hedged`. Only after the confirmed receipt is the purchase `HEDGED` and the merchant may fulfill. Do **not** call any Gemini order-placement endpoint.
6. If the quote is too high/stale, liquidity insufficient, a fill cannot be simulated, or Gemini is unavailable: mark `HEDGE_FAILED` and call `gateway.cancelUnhedged` (→ on-chain `Cancelled`, status `CANCELLED`). Cancellation creates a **refund entitlement**; the customer invokes `claim_refund` to receive the full mock deposit at their ATA, and the backend records `REFUNDED` only after that claim is verified. Do **not** fulfill the product before `HEDGED`.
7. On event end, backend checks the **officially finalized** settlement outcome from Gemini for the **exact** market used by the promotion and calls `gateway.resolvePromotion` (relayer-signed `resolve_promo`, once). If no reliable final outcome is available, hold funds and signal pending/admin recovery.
8. YES: the customer calls `claim_refund` for each `Hedged` purchase (its own `amount`). NO: the merchant calls `claim_merchant` per `Hedged` purchase. Settle the simulated Gemini position in the database only; it does not transfer real funds.

### Failure and non-atomicity policy

The Solana deposit, the off-chain Gemini data/simulation, and the Supabase writes **cannot be atomic**. Failure is a **refund/unwind**, never a fictitious successful hedge. Handle partial simulated fills as **not fully covered**: bounded retry or cancel. Idempotent event handling is mandatory; retrying a failed `mark_hedged` reuses the persisted simulated hedge and never simulates again. `mark_hedged` and `cancel_unhedged` are mutually exclusive on-chain (both need `Deposited`): on `INVALID_STATE` the backend re-reads the purchase and aligns to chain state. Do not set `HEDGED`, `CANCELLED`, `REFUNDED` or `CLAIMED` until the corresponding on-chain transaction is verified.

## 6. Anchor contract — finalized architecture (instructions still to be implemented by Dev 2)

Normative detail lives in `docs/interfaces.md` §1–3 and `programs/escrow/src/{state,events,errors}`. Summary:

**Escrow:** one pooled SPL vault per promotion (ATA of the Promo PDA, which is its authority) plus one Purchase PDA per deposit. Seeds: `Config ["config"]`, `Promo ["promo", merchant, promo_nonce u64 LE]`, `Purchase ["purchase", promo, customer, purchase_id [u8;16]]`. Token: mock USD, **6 decimals**, `u64` base units, checked arithmetic. Every payout equals exactly that purchase's `amount` and moves it to a terminal state; `Promo.total_deposited`/`total_paid_out` keep aggregate accounting consistent (`vault ≥ total_deposited − total_paid_out`). Admin has no withdrawal power.

**Authority:**

| Instruction | Action | Authority | While paused |
|---|---|---|---|
| `initialize_config` / `set_paused` / `set_relayer` | global config, pause, rotate relayer | Admin | allowed |
| `initialize_promo` | create promo + vault | Merchant | blocked |
| `deposit` | lock tokens, create Purchase | Customer | blocked |
| `mark_hedged` | `Deposited → Hedged` | The single relayer | blocked |
| `cancel_unhedged` | `Deposited → Cancelled` (refund entitlement) | The single relayer | allowed |
| `resolve_promo` | `Active → ResolvedYes/No`, once | The single relayer | blocked |
| `claim_refund` | `Cancelled → Refunded`, or `Hedged → ClaimedByCustomer` if YES | Purchase's customer | cancel path allowed; YES path blocked |
| `claim_merchant` | `Hedged → ClaimedByMerchant` if NO | Promo's merchant | blocked |

Prevent: hedging twice, hedging a cancelled purchase, cancelling a hedged purchase, double claims, repeated/conflicting resolution, deposits after the deadline or of a wrong amount, wrong mint/ATA, and one purchase consuming another's funds. Privileged instructions are retry-safe (distinct `Already*` errors; the gateway reports `alreadyApplied`).

**Events** (Anchor payloads carry no signature/slot/index; the listener attaches them): `DepositEvent` (`deposit`), `HedgeMarkedEvent` (`mark_hedged`), `PurchaseCancelledEvent` (`cancel_unhedged`), `ResolutionEvent` (`resolve_promo`), `ClaimEvent` (`claim_refund`/`claim_merchant`). Exact fields, TS mapping, dedupe id `signature:eventIndex`, finality and missed/duplicate/reordered handling: `docs/interfaces.md` §3. Prefer integer base units (`5 tokens = 5_000_000`).

**Open business rules (flagged, not decided):** treatment of purchases still `Deposited` at resolution (default: refund-only), customer escape hatch if the relayer disappears, no-resolution deadline, batch merchant claims. See `docs/interfaces.md` §8.

The concept document's names `mark_hedged` and `cancel_unhedged` are used; do not add a second cancellation instruction (`cancel_purchase`).

## 7. QuickNode + Solana client boundary

- QuickNode RPC is for transaction submission/reads; Streams or WebSocket logs for event delivery. The on-chain program **emits logs/events**; it does not call QuickNode HTTP APIs itself.
- `packages/solana` (Dev 3) should provide typed helpers such as `derivePromoPda`, `derivePurchasePda`, `getPurchaseState`, `verifyDeposit`, `subscribeToDeposits`, `buildDepositTransaction`, `resolvePromotion`, and `cancelUnhedged` (exact names can evolve together with documented interfaces).
- Split wallet/browser-safe utilities from **server-only** signing/event infrastructure. Do not import relayer keys into web UI.
- Independently validate event signatures, program ID, finalized status, mint, accounts, amounts, matching promotion/purchase, event position, and the resulting account/token state. Deduplicate by `(transaction signature, event index)` (`chainEventId`); delivery is at-least-once and handlers decide from on-chain state, not event order; replay from `fromSlot` after disconnects and reconcile with `listPurchases`. A WebSocket notification alone is not durable finality.
- The public contract is `SolanaServerGateway` (`packages/shared`): subscriptions for deposits/resolutions/claims, `markHedged`/`cancelUnhedged`/`resolvePromotion` (receipt only after the commitment is reached and state re-read; `alreadyApplied` for idempotent retries), `getConfig`/`getPromoState`/`getPurchaseState`/`listPurchases`, `verifyTransaction`, and `SolanaGatewayError` codes with retryability. See `docs/interfaces.md` §4.
- Developer 4 consumes verified notifications through `SolanaServerGateway`; they own application-level hedge/cancellation logic. Developer 3 owns this package; Developer 2 supplies the IDL and PDA seeds it implements.

## 8. Gemini data + simulation

- Source says **Rachel has a Gemini account**, but this does **not** prove usable API permissions, market coverage or live settlement endpoints. Confirm credentials/permissions, allowed data usage, exact market IDs, read-only methods, and rate limits before wiring real data.
- Live quotes must have source, timestamp, market identifier, ask/depth or explicitly labeled model assumptions; do not invent prices when live data fails.
- Simulation should capture `market_id`, `purchase_id`, requested YES contract quantity, quote, assumed fill quantity/price, premium, status, and eventual virtual payout. Simulate insufficient liquidity and partial/failure states.
- **No real placement, authenticated trade endpoints, orders, deposits or withdrawals.** Credentialed read-only endpoints, if needed, must be backend-only.
- Resolve only once official Gemini market-finality information is available. Backend relayer is responsible for mapping that outcome to Anchor YES/NO. If official settlement endpoint details are unverified, leave TODO rather than inventing a webhook or endpoint.

## 9. Database, API and lifecycle

Suggested Supabase tables: `promotions`, `purchases`, `simulated_hedges`, `market_quotes`, `market_outcomes`, plus processing checkpoints if necessary. Store Solana public keys as strings, market IDs, transaction signatures, confirmation state, status timestamps, and a unique deposit event identifier. Keep explicit simulated money units; use integer base units / decimal-safe arithmetic.

**Database orchestration statuses:**

`DEPOSITED -> PENDING_HEDGE -> HEDGE_SIMULATED -> HEDGED -> RESOLVED -> CLAIMED`

or

`DEPOSITED -> PENDING_HEDGE -> HEDGE_FAILED -> CANCEL_PENDING -> CANCELLED -> REFUNDED`

(`HEDGE_SIMULATED -> HEDGE_FAILED` if `mark_hedged` is abandoned.) Mapping to on-chain `PurchaseState` and the transition table: `docs/workflow.md`. `simulated_hedges` is unique per purchase so retries never duplicate a simulated hedge; a cancelled purchase's hedge becomes `VOIDED`. Not all of these statuses are on-chain; **on-chain vault and Purchase account are authoritative for escrow**. Database is a derived operational record. Supabase writes, Gemini reads, and Solana transactions must be reconciled and retried safely; they are not one transaction.

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
- Test: mark_hedged by non-relayer rejected; mark_hedged twice; mark_hedged after cancel; cancel_unhedged after hedge; mark_hedged vs cancel race; mark_hedged after resolution; pause behavior per instruction; multiple purchases by one customer; one purchase cannot claim another's funds; retried mark_hedged does not re-simulate; YES payout to customer; NO payout to merchant; quote-over-cap failure and refund; unavailable Gemini quote; partial hypothetical fill; stale quote; double claim; wrong signer/mint/ATA; duplicate/reordered events; repeated resolution; deadline expiry; failed relayer submission; vault balance conservation.
- Explicitly distinguish **real on-chain test transfers** from **simulated off-chain hedge executions** in dashboards, logs, and demos.

## 11. Milestones and division of integration

1. **M1 — On-chain:** Anchor program, mock mint, deposit, escrow and claims, local validator tests (Dev 2).
2. **M2 — Ingestion:** QuickNode Devnet RPC/Streams or WSS, verified deposits, dedupe and replay (Dev 3 SDK/listeners; Dev 4 worker hosting; Dev 2 supplies IDL/events).
3. **M3 — Hedge model:** Read-only Gemini adapter, explicit virtual fills, caps and exposure (Dev 4).
4. **M4 — Settlement:** Gemini finalized outcome mapping, trusted relayer, Anchor resolve, win/loss tests (Devs 2, 3 + 4).
5. **M5 — Experience:** Merchant dashboard, customer checkout, receipts, claims, polished economics demo (Dev 1, everyone integration testing).

All developers may work in parallel once type/schema/IDL/API interfaces are agreed. Start frontend with **clearly marked mock fixtures**; backend with stubbed Solana adapters; contract code with local validator tests. Do not block independent work on a deployed Devnet program.

## 11b. Conventions, commands and testing by owner

- TypeScript strict, ESM, Prettier (`pnpm format`), ESLint; integer base units as decimal strings (`TokenBaseUnits`), prices as micro-USD. Keep on-chain and off-chain fields in separate sub-objects. Stubs throw `NotImplementedError` / return 501; never fake data.
- Commands: `pnpm install`, `pnpm dev:web`, `pnpm dev:api`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`, `anchor build`. Per module: `pnpm --filter @hedged/<web|api|solana> typecheck`.
- Tests by owner (§10 lists the scenarios): Dev 2 — Anchor local-validator tests (claims, auth, pause, one-time resolve, conservation); Dev 3 — decoder/verification/dedupe/reconnect tests and Devnet checks, runnable without the API; Dev 4 — hedge simulation, state-machine idempotency, Gemini-unavailable/stale/partial cases using a labeled fake gateway; Dev 1 — component/flow tests against labeled fixtures. Cross-module scenarios live in `tests/`.
- Env vars are documented in `.env.example`; changes there need the affected owners' review. Relayer keypairs stay outside the repo (`RELAYER_KEYPAIR_PATH`) and are read only by server-side code.

## 12. Guidance for Claude Code in this repo

1. **Inspect the repository before editing.** Preserve existing implementations and avoid rewriting unrelated files.
2. **Ask which developer/module (Dev 1–4) is being implemented when scope is ambiguous, and stay inside that owner's paths.** If scaffolding the repo, create only minimal runnable apps, Anchor workspace, shared types, specs, scripts and `.env.example`, not a complete product.
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
