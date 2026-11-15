# Hedged Refund Promotions

## Repository structure

```text
apps/web          Dev 1 — Next.js (App Router) + Tailwind + Solana wallet adapter
apps/api          Dev 3 — Fastify API, Gemini adapter, hedging, Supabase, orchestration
programs/escrow   Dev 2 — Anchor/Rust escrow program
packages/solana   Dev 2 — Solana client, PDA helpers, QuickNode ingestion, relayer helpers
packages/shared   Shared TypeScript DTOs, statuses, monetary conventions
supabase/migrations   Dev 3 — PostgreSQL migrations
tests/            Integration / scenario tests
docs/             architecture, interfaces, ownership, setup
```

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

Scaffold only: structure, tooling, shared types, typed stubs. Business logic (escrow instructions,
deposit ingestion, Gemini adapter, hedge functionality, UI flows) is **not implemented**. Stubs throw
`NotImplementedError` or return HTTP 501 rather than faking behavior.

Docs: [architecture](docs/architecture.md) · [interfaces](docs/interfaces.md) ·
[ownership](docs/developer-ownership.md) · [setup](docs/setup.md)
