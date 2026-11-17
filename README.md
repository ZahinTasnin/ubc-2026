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

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm dev:web`   | Next.js dev server                             |
| `pnpm dev:api`   | Fastify dev server (tsx watch)                 |
| `pnpm build`     | Build all workspaces                           |
| `pnpm typecheck` | TypeScript checks for all workspaces           |
| `pnpm lint`      | ESLint across the repo                         |
| `pnpm format`    | Prettier write (`format:check` in CI)          |
| `anchor build`   | Build the escrow program (see `docs/setup.md`) |

## Status

Scaffold only: structure, tooling, shared types, Anchor account/event/error definitions, typed stubs. Business logic (escrow instructions,
deposit ingestion, Gemini adapter, hedge functionality, UI flows) is **not implemented**. Stubs throw
`NotImplementedError` or return HTTP 501 rather than faking behavior.

Docs: [architecture](docs/architecture.md) · [interfaces](docs/interfaces.md) · [workflow](docs/workflow.md) ·
[ownership](docs/developer-ownership.md) · [setup](docs/setup.md)
