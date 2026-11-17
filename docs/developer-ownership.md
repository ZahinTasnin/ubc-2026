# Developer ownership (4 developers)

Each developer works on their own branch and mostly edits only their own paths. Changes to a
path you do not own go through the owner (PR review from the owner required).

| Dev | Role                  | Owns                                                                               |
| --- | --------------------- | ---------------------------------------------------------------------------------- |
| 1   | Frontend              | `apps/web`                                                                         |
| 2   | Smart contracts       | `programs/escrow`, `Anchor.toml`, `Cargo.toml`/`Cargo.lock`, `programs/escrow/idl` |
| 3   | Solana infrastructure | `packages/solana`                                                                  |
| 4   | Backend + Gemini      | `apps/api`, `supabase/migrations`                                                  |
| all | Shared contracts      | `packages/shared`, `docs/interfaces.md`, `.env.example` (PR needs affected owners) |

`tests/`: each owner adds tests for their module (Anchor tests Dev 2; Solana-against-Devnet Dev 3;
backend Dev 4); cross-module scenario tests are a joint effort.

## Developer 1 — Frontend (Next.js, TypeScript, Wallet Adapter)

- Merchant dashboard: create promotions, view purchases and (simulated) hedge status.
- Customer checkout: wallet connection, mock-USDC deposit; customer refund and merchant claim UIs.
- Uses `@hedged/solana` (browser-safe entry) for PDAs, state reads and unsigned tx builders; uses
  `apps/api` REST for off-chain status. Mock responses only as clearly marked fixtures.
- Never imports `@hedged/solana/server`; no secrets or privileged keys in the bundle.

## Developer 2 — Smart contracts (Anchor, Rust, SPL Token)

- Promo/Purchase PDAs, escrow vault(s), authorization, accounting.
- Architecture (final): one pooled token vault per promotion (ATA of the Promo PDA) + one
  Purchase PDA per deposit; exact per-purchase liabilities; checked u64 arithmetic; 6 decimals.
- Instructions: `initialize_config`, `set_paused`, `set_relayer`, `initialize_promo`, `deposit`,
  `mark_hedged`, `cancel_unhedged` (creates a refund entitlement), `resolve_promo`, `claim_refund`,
  `claim_merchant`. Authority and pause matrix: `docs/interfaces.md` §2. One authorized relayer,
  admin pause (no withdrawal power), one-time resolution, double-claim prevention.
- Events: `DepositEvent`, `HedgeMarkedEvent`, `PurchaseCancelledEvent`, `ResolutionEvent`,
  `ClaimEvent` (schemas in `docs/interfaces.md` §3; Rust in `programs/escrow/src/events.rs`).
- Exports IDL, program ID, account schemas and PDA-seed docs; Anchor tests; Devnet deployment;
  mock mint creation.
- **Boundary:** on-chain logic only — not QuickNode, listeners, or the off-chain Solana SDK.

## Developer 3 — Solana infrastructure (QuickNode, web3.js, Anchor TS client)

- QuickNode RPC/WSS configuration; deposit and resolution listeners; Anchor event decoding.
- Verification of signatures, token transfers, mint/accounts/amounts, commitment/finality.
- Dedupe `(signature, eventIndex)`, retries, WebSocket reconnect, checkpoint replay.
- Reusable SDK: PDA helpers, state reads, tx builders (browser-safe) and server-only
  `markHedged` / `cancelUnhedged` / `resolvePromotion` with relayer signing kept server-side.
- Verifies finalized transactions and account/token state before emitting any event (events are
  notifications, not proof). Owns relayer-key loading and signing of `mark_hedged`,
  `cancel_unhedged`, `resolve_promo`.
- Implements `SolanaServerGateway` (`@hedged/shared`) for Dev 4. Testable on its own against
  localnet/Devnet with no backend or database running.
- **Boundary:** off-chain Solana integration only — not Rust contract logic, Gemini, or Supabase.

## Developer 4 — Backend + Gemini (Node.js, TypeScript, Supabase)

- Read-only Gemini quotes and finalized outcomes; simulated hedge fills, premiums, positions, and
  payouts (never real trades).
- Supabase schema, purchase/hedge state machine, REST APIs, workers.
- Consumes verified deposits via `SolanaServerGateway`; persists the simulated hedge once
  (unique per purchase), then calls `markHedged` and sets HEDGED only on a confirmed receipt; on
  hedge failure calls `cancelUnhedged` (customer then claims the refund; REFUNDED only after the
  claim is verified); at event end calls `resolvePromotion`. Idempotent processing, retries, reconciliation.
- **Boundary:** no Solana-specific logic (no raw web3.js/Anchor instruction building, no event
  decoding); no on-chain logic.

## Dependency direction (no cycles)

```text
programs/escrow --IDL--> packages/solana --gateway--> apps/api --REST--> apps/web
                               │  ▲                                         │
                               └──┴── packages/shared (types only) ─────────┘
                       apps/web also uses packages/solana (browser-safe entry only)
```

`packages/shared` imports nothing from the workspace. `packages/solana` imports only
`@hedged/shared`. `apps/api` imports `@hedged/shared` and `@hedged/solana/server`. `apps/web`
imports `@hedged/shared` and `@hedged/solana` (never `/server`).
