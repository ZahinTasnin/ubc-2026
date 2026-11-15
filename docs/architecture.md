# Architecture

```text
 Customer/Merchant wallet ──(signs)──► Anchor escrow program (Solana Devnet)
        ▲  apps/web (Next.js)               │ emits DepositEvent / logs
        │                                   ▼
        │                          QuickNode RPC + Streams/WSS
        │                                   │
        │                        packages/solana (verify, dedupe, replay)
        │                                   │ verified events
        ▼                                   ▼
   apps/api (Fastify) ◄──── orchestration ──┘
        │   ├─ Gemini Predictions adapter  (READ-ONLY quotes + official settlement)
        │   ├─ Simulated hedge ledger      (off-chain, labeled simulated)
        │   └─ Supabase PostgreSQL         (derived operational record)
        └─► authorized relayer (server-only keys) → mark_hedged / cancel_unhedged / resolve_promo
```

## Principles

- **Two separate ledgers:** Solana escrow (real Devnet test-token movement) vs the simulated
  Gemini hedge ledger (database only). No bridging.
- **On-chain Promo/Purchase accounts and the vault are authoritative for escrow.** The database is
  a derived record; reconcile and retry, never assume atomicity across Solana/Gemini/Supabase.
- **Gemini is read-only.** Never place orders. If official settlement is unavailable, leave
  resolution pending (or use a clearly labeled manual demo fixture).
- **QuickNode is infrastructure**, not an outcome oracle.
- **Trusted relayer** (MVP) validates the exact market's official outcome and signs `resolve_promo`
  once. Production oracle/dispute design is out of scope.

## Lifecycle

`DEPOSITED → PENDING_HEDGE → HEDGED → RESOLVED → CLAIMED`
or `DEPOSITED → PENDING_HEDGE → HEDGE_FAILED → CANCEL_PENDING → REFUNDED`
(`REFUNDED` only after the on-chain refund is verified.)

See `CLAUDE.md` §5 for the workflow and failure policy.
