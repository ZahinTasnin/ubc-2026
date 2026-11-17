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
    scripts/                # Dev 2 — Devnet tooling: mock mint, Config init, readiness check (never mainnet)
    docs/                   # Dev 2 — SECURITY, INTEGRATION (Dev 3/4 handoff), DEVNET checklist, D2 decision record
    docs.md                 # Dev 2 — high-level technical overview of the escrow program
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
- Instructions: `initialize_config`, `set_paused`, `set_relayer`, `set_cancel_timeout`, `initialize_promo`, `deposit`, `mark_hedged`, `cancel_unhedged` (the **relayer's** cancellation; it creates a refund entitlement), `cancel_expired_deposit` (the **customer's** timeout-based cancellation of a still-`Deposited` purchase; same entitlement, see §6), `resolve_promo`, `claim_refund`, `claim_merchant`. Authority/pause matrix: `docs/interfaces.md` §2 and §6 below.
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
- Owns hedge execution, retry logic, idempotency and hedge/on-chain reconciliation, per the **pending** requirements in §5.1 (not yet implemented or verified).
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

1. Merchant chooses an existing Gemini market/event, promo price, deadline, max hedge quote, and budget (max price/budget are off-chain; the Promo PDA stores merchant, mint, offer amount, deposit deadline, exact market id and a snapshot of the cancel timeout).
2. Customer connects a Solana wallet and signs `deposit` of **5 mock stablecoins** (customer ATA → the promotion vault) with a client-generated `purchase_id`; a Purchase PDA (`Deposited`) is created and `DepositEvent` emitted.
3. Dev 3's infra detects the event via QuickNode and **verifies the finalized transaction and account/token state** (events are notifications, not proof) before notifying the backend.
4. Backend records the purchase idempotently, retrieves the **real** Gemini quote/order book and computes a **hypothetical** number of $1-payout YES contracts and premium using available depth and explicitly modeled assumptions.
5. If cap/budget/freshness/liquidity rules pass, the backend **persists the simulated hedge once** (unique per purchase) → `HEDGE_SIMULATED`, then calls `gateway.markHedged`. The gateway builds and submits the relayer-signed `mark_hedged`; Anchor checks relayer authority and moves the purchase to `Hedged`. Only after the confirmed receipt is the purchase `HEDGED` and the merchant may fulfill. Do **not** call any Gemini order-placement endpoint.
6. If the quote is too high/stale, liquidity insufficient, a fill cannot be simulated, or Gemini is unavailable: mark `HEDGE_FAILED` and call `gateway.cancelUnhedged` (→ on-chain `Cancelled`, status `CANCELLED`). Cancellation creates a **refund entitlement**; the customer invokes `claim_refund` to receive the full mock deposit at their ATA, and the backend records `REFUNDED` only after that claim is verified. Do **not** fulfill the product before `HEDGED`.
7. On event end, backend checks the **officially finalized** settlement outcome from Gemini for the **exact** market used by the promotion and calls `gateway.resolvePromotion` (relayer-signed `resolve_promo`, once). If no reliable final outcome is available, hold funds and signal pending/admin recovery.
8. YES: the customer calls `claim_refund` for each `Hedged` purchase (its own `amount`). NO: the merchant calls `claim_merchant` per `Hedged` purchase. Settle the simulated Gemini position in the database only; it does not transfer real funds.

### Failure and non-atomicity policy

The Solana deposit, the off-chain Gemini data/simulation, and the Supabase writes **cannot be atomic**. Failure is a **refund/unwind**, never a fictitious successful hedge. Handle partial simulated fills as **not fully covered**: bounded retry or cancel. Idempotent event handling is mandatory; retrying a failed `mark_hedged` reuses the persisted simulated hedge and never simulates again. `mark_hedged`, `cancel_unhedged` and the customer's `cancel_expired_deposit` are mutually exclusive on-chain (all need `Deposited`): on `INVALID_STATE` the backend re-reads the purchase and aligns to chain state (a customer timeout-cancel can win the race against a slow `mark_hedged`; the backend then voids the simulated hedge). Do not set `HEDGED`, `CANCELLED`, `REFUNDED` or `CLAIMED` until the corresponding on-chain transaction is verified.

### 5.1 Backend hedge execution: idempotency, retries, reconciliation (Developer 4) — **PENDING**

> **Status: PENDING. These are implementation requirements for Developer 4, not features that exist.** Nothing below is implemented or verified. Tick an item only when code **and** a test for it exist (tests per §10/§11b) and Dev 4 reports the commands run; until then treat it as open. Developer 2 and Developer 3 have implemented nothing in this section.
>
> **Applicability.** The MVP never places real orders (§2, §8): the "hedge" is a simulated ledger entry, and Gemini is read-only. The rules below apply **now** to the simulated hedge (its persistence, retries of read-only Gemini quote/order-book calls, `mark_hedged`/`cancel_unhedged` submission, restart safety and reconciliation) and are **binding design requirements for any future real execution** (post-MVP). "Order", "fill" and "exposure" below mean the simulated order/fill/exposure in the MVP; the simulation must exercise the same pending / partial / filled / failed / cancelled states so the logic is proven before real money is ever involved. Do not use this section as a reason to call a trading endpoint.

1. **Idempotent hedge execution.**
   - The idempotency key is the on-chain **Purchase PDA** (equivalently its `purchase_id`; use the PDA address). One purchase → **at most one** intended hedge position, enforced by a database unique constraint (already required for `simulated_hedges`, §9) and not just by application logic.
   - Duplicate deposit events, API retries and backend restarts must never create a second hedge: the worker claims the purchase and creates the hedge record in one atomic, unique-keyed step *before* any external call, and every retry reuses that record.
2. **Retry strategy.**
   - Bounded retries with **exponential backoff and jitter** for transient failures; a hard attempt/time cap per purchase.
   - Classify errors: **retryable** (timeouts, rate limits / 429, temporary 5xx, connection resets) vs **permanent** (validation errors, rejected orders, quote over cap, insufficient liquidity, authorization failures). Permanent failures are not retried.
   - **Never blindly resubmit a hedge order whose execution status is unknown** (see 3).
   - Use the exchange's native idempotency / **client-order-ID** mechanism where one exists, set deterministically from the purchase key; never generate a fresh ID per attempt.
3. **Order reconciliation.**
   - On a timeout or ambiguous response, **look up the original order first** (by client-order-ID/purchase key) before any retry.
   - Handle every state explicitly: **pending, partially filled, completed, failed, cancelled**. A partial fill is *not fully covered* (§5 failure policy): bounded completion attempt or cancel/unwind, never reported as hedged.
   - Persist hedge execution state (key, client-order-ID, status, filled quantity, average price, timestamps, attempt count, last error) so retries are safe across restarts; on boot, resume from the persisted state.
   - If the external API **cannot** guarantee idempotent execution or reliable order lookup, **do not automatically resubmit an ambiguous order**: mark it for manual reconciliation.
4. **Cancellation timeout (on-chain).**
   - A customer can cancel their own still-`Deposited` purchase with `cancel_expired_deposit` once `now ≥ purchase.deposited_at + promo.cancel_timeout_secs`. The timeout is an **admin-set config value snapshotted per promo** (`Promo.cancelTimeoutSecs`); the Devnet/demo default set by `pnpm escrow:init-config` is **600 s (10 minutes)**, and localnet tests use a few seconds. Read it per promo from chain; do not hardcode 600.
   - **Stop initiating new hedge orders with enough margin before `deposited_at + cancel_timeout_secs`** for the order to execute, `mark_hedged` to be submitted, and the on-chain confirmation to arrive (budget the worst-case order latency plus the confirmation latency at the configured commitment; Dev 4 sets and documents the margin; as a starting point, stop new orders at roughly the last 30% of the window).
   - **Before placing a hedge, re-read the purchase on-chain** and verify it is still `Deposited` and eligible (promo `Active`, not paused for `mark_hedged`, within margin, cap/budget/freshness passed).
   - After a successful execution, **promptly submit `mark_hedged` and confirm the on-chain `Hedged` state** (receipt after the commitment, state re-read). **Never assume a successful off-chain hedge means the purchase is `Hedged` on-chain.** The customer-facing/merchant-facing status becomes `HEDGED` only after that confirmation.
   - **Handle the race** where the customer's `cancel_expired_deposit` lands before `mark_hedged`: the relayer call fails (`INVALID_STATE`), the backend re-reads chain state, sees `Cancelled`, and treats the executed hedge as **orphaned exposure** → reconcile/unwind (5 below); the simulated hedge becomes `VOIDED` only once any exposure is accounted for.
5. **Failure recovery.**
   - Retry failed Solana submissions (`markHedged`, `cancelUnhedged`) safely through the gateway **without** touching the external hedge order again: the order state is already persisted, only the on-chain step is retried.
   - Continuously **reconcile on-chain purchase status against persisted off-chain hedge status** (`listPurchases` + the hedge table); any mismatch (hedge filled but purchase `Cancelled`/still `Deposited`; purchase `Hedged` with no confirmed hedge) is repaired or raised.
   - If a hedge executes but on-chain confirmation **fails permanently** (e.g. the purchase was cancelled), **flag the position for reconciliation or unwind** (alert/record), never silently abandon it.
   - **Relayer-initiated `cancelUnhedged` is performed only when the backend can establish that no active hedge exposure remains** (no order placed, or every order confirmed failed/cancelled with zero fills, or fully unwound). If exposure is unknown or ambiguous, do **not** cancel on-chain automatically: flag for manual reconciliation (note the customer's timeout cancel may still happen independently, so resolve quickly).
6. **Responsibilities.**
   - **Developer 4** owns hedge execution, retry logic, idempotency and reconciliation (this section).
   - **Developer 3** owns the Solana transaction integration (`SolanaServerGateway`) and must **coordinate confirmation failures with Developer 4** (typed errors, `alreadyApplied`, `TX_TIMEOUT` = outcome unknown → re-read state).
   - **Developer 2's** Anchor program enforces purchase states and the timeout cancellation; it **does not** perform API retries, order handling or reconciliation.

Verification checklist (all **pending**; Dev 4 to implement and test): [ ] unique constraint on the hedge idempotency key; [ ] duplicate deposit event / restart creates no second hedge; [ ] backoff + jitter + attempt cap, retryable vs permanent classification; [ ] timeout → lookup before retry; [ ] pending/partial/filled/failed/cancelled handled; [ ] stop-new-hedge margin before `cancel_timeout_secs`; [ ] on-chain re-check before hedging; [ ] `mark_hedged` confirmation before `HEDGED`; [ ] customer-cancel race → orphan exposure flagged; [ ] reconciliation job repairs/flags mismatches; [ ] `cancelUnhedged` only with no exposure; [ ] ambiguous orders never auto-resubmitted.

## 6. Anchor contract — implemented by Dev 2 (12 instructions; Devnet deploy still pending)

Normative detail lives in `docs/interfaces.md` §1–3 and `programs/escrow/src/{state,events,errors}`. Summary:

**Escrow:** one pooled SPL vault per promotion (ATA of the Promo PDA, which is its authority) plus one Purchase PDA per deposit. Seeds: `Config ["config"]`, `Promo ["promo", merchant, promo_nonce u64 LE]`, `Purchase ["purchase", promo, customer, purchase_id [u8;16]]`. Token: mock USD, **6 decimals**, `u64` base units, checked arithmetic. Every payout equals exactly that purchase's `amount` and moves it to a terminal state; `Promo.total_deposited`/`total_paid_out` keep aggregate accounting consistent (`vault ≥ total_deposited − total_paid_out`). Admin has no withdrawal power. `Config` also holds `cancel_timeout_secs` (customer-recovery timeout, admin-set, 1 s to 30 days) and each `Promo` snapshots it at `initialize_promo`; Devnet default **`CANCEL_TIMEOUT_SECS=600`** (10 minutes), set by `pnpm escrow:init-config`.

**Authority:**

| Instruction | Action | Authority | While paused |
|---|---|---|---|
| `initialize_config` / `set_paused` / `set_relayer` / `set_cancel_timeout` | global config (incl. customer-recovery timeout), pause, rotate relayer, set timeout for future promos | Admin (`initialize_config`: the program's upgrade authority) | allowed |
| `initialize_promo` | create promo + vault (snapshots the config's cancel timeout) | Merchant | blocked |
| `deposit` | lock tokens, create Purchase | Customer | blocked |
| `mark_hedged` | `Deposited → Hedged` | The single relayer | blocked |
| `cancel_unhedged` | `Deposited → Cancelled` (refund entitlement) | The single relayer | allowed |
| `cancel_expired_deposit` | `Deposited → Cancelled` (refund entitlement) once `now ≥ deposited_at + promo.cancel_timeout_secs`; never for a `Hedged` purchase | The purchase's own customer | allowed |
| `resolve_promo` | `Active → ResolvedYes/No`, once, **only at/after `deposit_deadline`** | The single relayer | blocked |
| `claim_refund` | `Cancelled → Refunded`, or `Hedged → ClaimedByCustomer` if YES | Purchase's customer | cancel path allowed; YES path blocked |
| `claim_merchant` | `Hedged → ClaimedByMerchant` if NO | Promo's merchant | blocked |

Prevent: hedging twice, hedging a cancelled purchase, cancelling a hedged purchase, double claims, repeated/conflicting resolution, deposits after the deadline or of a wrong amount, wrong mint/ATA, and one purchase consuming another's funds. Privileged instructions are retry-safe (distinct `Already*` errors; the gateway reports `alreadyApplied`).

**Events** (Anchor payloads carry no signature/slot/index; the listener attaches them): `DepositEvent` (`deposit`), `HedgeMarkedEvent` (`mark_hedged`), `PurchaseCancelledEvent` (`cancel_unhedged` **or** `cancel_expired_deposit`), `ResolutionEvent` (`resolve_promo`), `ClaimEvent` (`claim_refund`/`claim_merchant`). Exact fields, TS mapping, dedupe id `signature:eventIndex`, finality and missed/duplicate/reordered handling: `docs/interfaces.md` §3. Prefer integer base units (`5 tokens = 5_000_000`).

**Decided MVP security rules** (`programs/escrow/docs/SECURITY.md`): (D1) one trusted relayer, no multisig/settlement delay/dispute mechanism; (D3) the admin pause stays as specified (no auto-expiry; cancelled-purchase refunds stay allowed while paused); (D4) `resolve_promo` is rejected strictly before `promo.deposit_deadline` (merchants must set the deadline no later than the event end); (D2, partially approved) a customer can cancel their own **`Deposited`** purchase after the configured timeout via `cancel_expired_deposit`, then refund through the normal `claim_refund` cancel path. **Hedged purchases are never refunded or expired by timeout**: an on-chain timeout does not prove an off-chain hedge was unwound, so a hedged purchase keeps waiting for resolution and **late resolution stays possible** (automatic promo-expiry refunds were reviewed and explicitly **not approved**; see `programs/escrow/docs/D2-PROPOSAL.md`). The backend's hedge window must stay well below `cancel_timeout_secs`, and it voids any simulated hedge for a purchase it sees cancelled on-chain.

**Open business rules (flagged, not decided):** treatment of purchases still `Deposited` at resolution (default: refund-only, now also customer-recoverable after the timeout), what to do for hedged purchases when no resolution ever arrives (currently: remain locked, relayer can resolve late), batch merchant claims. See `docs/interfaces.md` §8.

**Off-chain hedge vs. on-chain cancellation race (documented risk).** The hedge (simulated in the MVP, possibly real later) lives off-chain, while a purchase's `Deposited → Hedged` transition is an on-chain relayer call. These cannot be atomic. Between "hedge executed" and "`mark_hedged` confirmed", the customer may call `cancel_expired_deposit` (once `deposited_at + cancel_timeout_secs` has passed), or the relayer may cancel; `mark_hedged`, `cancel_unhedged` and `cancel_expired_deposit` all require `Deposited`, so exactly one wins and the loser fails with `InvalidState`. If the cancel wins, the purchase is refundable and the backend is left holding a hedge for a purchase that will never be `Hedged`: **orphaned exposure** that the contract can neither see nor unwind. Remaining risks: (a) in the MVP the exposure is simulated, so there is no real loss, but the simulated ledger must still be reconciled; (b) with real hedges the merchant would bear that exposure; (c) the contract cannot tell whether an off-chain hedge was ever placed, unwound or is still outstanding, so no on-chain rule can fully close this gap; (d) it is mitigated only operationally, by the Developer 4 requirements in §5.1 (stop hedging well before the timeout, confirm `mark_hedged` before treating a hedge as live, flag/unwind orphaned positions, cancel on-chain only with no exposure). Those mitigations are **pending implementation**, not completed features.

The concept document's names `mark_hedged` and `cancel_unhedged` are used. There are exactly **two** cancellation paths, both ending in `Cancelled` + a refund entitlement and both requiring `Deposited`: the relayer's `cancel_unhedged` and the customer's timeout-gated `cancel_expired_deposit`. Do not add any other cancellation instruction (e.g. `cancel_purchase`); this supersedes the earlier "single cancellation instruction" rule.

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
- Commands: `pnpm install`, `pnpm dev:web`, `pnpm dev:api`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`, `anchor build`, `anchor test` (localnet, ~25 min), `cargo test -p escrow`, and Dev 2 Devnet tooling `pnpm escrow:check [--online]`, `pnpm escrow:mint`, `pnpm escrow:init-config` (see `programs/escrow/docs/DEVNET.md`). Per module: `pnpm --filter @hedged/<web|api|solana> typecheck`.
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

## 14. Post-MVP roadmap (prioritized; NOT part of the MVP — do not implement now)

### 14.1 Post-Hedge Merchandise Returns & Hedge Unwinding — HIGH PRIORITY, first major post-MVP enhancement

Today a purchase is `Hedged` until the market resolves and only then settles (YES → customer, NO → merchant); there is no way for a customer to return merchandise after the hedge was placed. This feature adds it. **Documentation only: do not implement in the MVP, in the Anchor program, the backend or the UI.**

**Proposed workflow**

1. The customer requests to return/cancel a purchase **after** the hedge has been placed.
2. The merchant approves the return according to its return policy.
3. The backend sells/unwinds the hedge contracts **allocated to that specific purchase**.
4. The backend calculates the **realized hedge loss** from actual execution proceeds, accounting for trading fees and slippage.
5. The customer receives a refund **minus the realized hedge loss**, if any, where such deductions are disclosed and legally permitted.
6. The merchant is compensated for the realized hedge loss out of the escrow.
7. The purchase moves to a terminal `Returned` state, preventing double claims.

**Proposed refund formula**

```
deduction       = min(purchase_amount, max(0, original_hedge_cost - net_hedge_sale_proceeds))
customer_refund = purchase_amount - deduction
merchant_comp   = deduction
```

The deduction is capped at the purchase amount. If the hedge appreciates (proceeds ≥ cost) the deduction is 0: the customer receives the full purchase amount and the merchant retains any hedge profit. `net_hedge_sale_proceeds` must be the actual, confirmed execution proceeds net of fees and slippage, never a quoted or modeled price.

**Implementation requirements to document and design before building**

- **Per-purchase hedge position tracking:** each purchase's contracts, average cost, fees and fill history must be separable from other purchases (no pooled, unallocated positions).
- **Merchant-approved return authorization:** an explicit, attributable approval (who, when, which purchase) before any unwind starts.
- **Actual hedge sale execution and confirmation before on-chain settlement:** settle on-chain only after the sale is confirmed and the realized loss is final; never on a quote.
- **Partial escrow payouts:** one purchase pays two parties (customer refund and merchant compensation) whose sum must equal exactly the purchase amount; a new on-chain `Returned` terminal state and a settlement instruction with checked arithmetic, authorized by the trusted relayer plus the merchant approval.
- **Protection against double claims, partial fills and inconsistent backend reporting:** idempotent settlement keyed per purchase; partial unwind fills must not be reported as complete; reconcile backend ledger vs. on-chain state; the contract must cap total payouts at the purchase amount regardless of what the backend reports.
- **Returns after the original escrow already settled:** define the handling when the market has resolved and the escrow was already claimed (clawback is not possible on-chain; needs merchant-funded refunds or a different settlement ordering).
- **Compliance with applicable consumer refund requirements:** jurisdictional rules on refunds, deductions and disclosures must be reviewed before any deduction is applied (see §13).

This interacts with the D2 timeout work only in that hedged purchases are deliberately **not** cancellable by an on-chain timeout: unwinding a real hedge must be confirmed off-chain first, which is exactly what this feature would provide.

**Bottom line:** Build a demonstrable, auditable *simulation* of on-chain conditional refunds + off-chain prediction-market-informed hedge accounting. Keep every simulated execution clearly distinguished from actual chain transactions and Gemini market data.
