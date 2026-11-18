# Hedged Refund Promotions

## Repository structure

```text
apps/web              Dev 1 — Next.js (App Router) + Tailwind + Solana wallet adapter
programs/escrow       Dev 2 — Anchor/Rust escrow program (+ idl/ export)
packages/solana       Dev 3 — Solana SDK: PDAs, tx builders, QuickNode listeners, verification, relayer helpers
apps/api              Dev 4 — Fastify API, Gemini adapter, hedge simulation, Supabase, workers
supabase/migrations   Dev 4 — PostgreSQL migrations
packages/shared       Shared TypeScript DTOs, statuses, SolanaServerGateway interface (all, via PR)
tests/                Integration / scenario tests
docs/                 architecture, interfaces, ownership, setup
```

See [developer ownership](docs/developer-ownership.md) for boundaries and dependency direction.

Architecture is finalized: one pooled vault per promotion + a Purchase PDA per deposit, on-chain
`mark_hedged` by a single relayer, customer-pulled refunds after `cancel_unhedged`. Specs:
[interfaces](docs/interfaces.md) (PDAs, events, gateway) and [workflow](docs/workflow.md)
(state machines, races).

## Quick start

```bash
pnpm install
cp .env.example .env     # fill in as needed; never commit .env
pnpm dev:web             # http://localhost:3000
pnpm dev:api             # http://localhost:4000/health
```

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `pnpm dev:web`      | Next.js dev server                             |
| `pnpm dev:api`      | Fastify dev server (tsx watch)                 |
| `pnpm build`        | Build all workspaces                           |
| `pnpm typecheck`    | TypeScript checks for all workspaces           |
| `pnpm lint`         | ESLint across the repo                         |
| `pnpm format`       | Prettier write (`format:check` in CI)          |
| `anchor build`      | Build the escrow program (see `docs/setup.md`) |
| `anchor test`       | Escrow localnet tests (~25 min)                |
| `pnpm escrow:check` | Escrow deployment-readiness check              |

## Status

- **Escrow program (Dev 2): implemented.** 12 Anchor instructions with localnet tests
  (`programs/escrow/docs.md`); not yet deployed to Devnet.
- **Backend (Dev 4): implemented** in `apps/api` with tests: read-only Gemini adapter (live quotes,
  order books, official settlement, 5-minute crypto windows, per-game line picker), simulated hedge
  model, purchase orchestrator and workers (CLAUDE.md §5.1 race handling), promotions directory,
  merchant dashboard and receipts, Supabase store (`supabase/migrations`). Routes:
  `docs/interfaces.md` §6. `pnpm --filter @hedged/api test` (in-memory) and `test:db` (Supabase).
- **Not yet:** the real Devnet `SolanaServerGateway` (Dev 3; until then the backend's workers run only
  on an in-memory fake chain with `SOLANA_GATEWAY=fake`) and the web UI (Dev 1).

## Economic design

**Mechanism.** A promo refunds the purchase price `R` if a specific Gemini market resolves YES. For
each sale the backend sizes a hedge of `R / $1` YES contracts (rounded up to Gemini's 0.01 step) and
prices it against the live ask side of the order book, so the hedge pays exactly `R` if the refund
is owed. If the average fill price is `p`, the promo costs the merchant `C = p × R` per sale, plus
any modelled fees.

**Result for the merchant** (fully hedged, before cost of goods), per $5 sale at `p = $0.34`:

|                       | Outcome YES | Outcome NO |
| --------------------- | ----------- | ---------- |
| Sale (held in escrow) | +$5.00      | +$5.00     |
| Hedge premium         | −$1.70      | −$1.70     |
| Hedge payout          | +$5.00      | $0         |
| Refund to customer    | −$5.00      | $0         |
| **Merchant keeps**    | **$3.30**   | **$3.30**  |

The hedge fixes the promo's cost at `p × R`; it does not make the promo free. `p` is the
market-implied probability of the refund, so the cost behaves like a discount of `p` that the
customer experiences as a chance at a free item.

**Exposure desk (platform level).** Shops pay the live per-sale price, but the platform does not
hedge each sale separately. It nets exposure across all shops per Gemini event: on a game where some
shops promise "free if Texas wins" and others "free if Arkansas wins", the amount owed whichever team
wins is covered by the premiums collected, and only the remainder is hedged, in batches. The
difference is platform revenue (in the tested example: $487 of premiums, $184 of hedging, covered in
both outcomes). See `apps/api/src/desk/README.md`.

**Merchant controls.** A threshold (maximum YES price, i.e. maximum cost as a share of the price),
a total hedge budget, and a deposit deadline. Each sale is priced at the moment it happens; when the
live price is above the threshold or the budget is used up, the promo shows as paused and checkout
does not take payment. The line picker suggests, for a game, the most likely outcome that fits the
threshold (e.g. "wins by 14+" when "wins" is too expensive).

**What is real and what is simulated.** Real: Gemini prices, order books and official settlement
(read-only, public endpoints); escrow transfers on Solana Devnet in a valueless mock stablecoin.
Simulated: buying and settling the Gemini contracts, which are recorded in an off-chain ledger and
labelled `simulated: true` everywhere. No Gemini order is ever placed.

### Risks and how the design handles them

| Risk                                               | Handling                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price moves before or during a sale                | Each sale is quoted live; above the merchant's threshold the hedge fails and the deposit is refunded before the item is handed over.                                 |
| Thin order book / partial fill                     | A partial fill is never treated as covered: the simulated fill is released and the customer refunded.                                                                |
| Payment and hedge are not atomic                   | Purchase is `PENDING` until `mark_hedged` is confirmed on-chain; the item is served only after that (`canServe`). Failures cancel and refund.                        |
| Customer self-cancels while the hedge is in flight | New hedges stop at 70% of the on-chain cancel window; if the cancel still wins, the hedge is voided and its budget released.                                         |
| Buying after the outcome is partly known           | Sports promos stop selling at kickoff; 5-minute crypto windows stop 5 minutes before the reference price is captured.                                                |
| Wrong or premature result                          | Only Gemini's official settlement (`resolutionSide`) of the exact market is used; never prices near 0/1 or live scores. Resolution happens once, after the deadline. |
| Cancelled or voided game                           | No automatic resolution; flagged for an operator.                                                                                                                    |
| Budget overrun                                     | Budget is reserved atomically per hedge in the database; a sale that does not fit is refunded.                                                                       |
| Fees and slippage                                  | Fill price walks the visible book; Gemini fees are a configurable parameter (0 = not modelled).                                                                      |
| Trusted relayer                                    | A single backend relayer can resolve and cancel, but funds can only move to the recorded customer or merchant. A decentralised oracle is out of scope.               |

**Production blockers (not solved here):** real execution on Gemini (account, fees, minimum sizes,
liquidity), custody and settlement of real funds, promotional and gaming regulations by
jurisdiction, KYC/AML, and card/fiat checkout.

**Solana infrastructure (Dev 3): implemented** — `packages/solana`: PDAs, reads, wallet transaction
builders, the relayer-signed `SolanaServerGateway`, verified event subscriptions (replay, dedupe,
redelivery) and QuickNode RPC + **Streams** (filter, HMAC-verified webhook). Tested against the deployed
Devnet binary on a local validator (`pnpm --filter @hedged/solana test:localnet`); see
[packages/solana/README.md](packages/solana/README.md), incl. the Stream configuration.

Docs: [architecture](docs/architecture.md) · [interfaces](docs/interfaces.md) · [workflow](docs/workflow.md) ·
[ownership](docs/developer-ownership.md) · [setup](docs/setup.md)
