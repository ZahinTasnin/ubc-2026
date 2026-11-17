# Architecture

```text
 Customer/Merchant wallet ──(signs)──► Anchor escrow program (Solana Devnet)
        ▲  apps/web (Next.js)               │ emits DepositEvent / logs
        │                                   ▼
        │                          QuickNode RPC + Streams/WSS
        │                                   │
        │                        packages/solana (Dev 3: verify, dedupe, replay)
        │                                   │ verified events
        ▼                                   ▼
   apps/api (Dev 4) ◄── SolanaServerGateway ┘
        │   ├─ Gemini Predictions adapter  (READ-ONLY quotes + official settlement)
        │   ├─ Simulated hedge ledger      (off-chain, labeled simulated)
        │   └─ Supabase PostgreSQL         (derived operational record)
        └─► SolanaServerGateway → relayer (server-only key, Dev 3) → mark_hedged / cancel_unhedged / resolve_promo
```

## Principles

- **Two separate ledgers:** Solana escrow (real Devnet test-token movement) vs the simulated
  Gemini hedge ledger (database only). No bridging.
- **One token vault per promotion + one Purchase PDA per deposit.** Funds are pooled; each
  purchase carries its own exact liability and can be paid out once, only its own amount
  ([interfaces.md §1](interfaces.md)).
- **On-chain hedge confirmation:** after a successful simulation the backend asks the gateway to
  submit the relayer-signed `mark_hedged`; a purchase is HEDGED only after that is confirmed.
- **Single relayer** (Config PDA) signs `mark_hedged`, `cancel_unhedged`, `resolve_promo`; it can
  never redirect funds. Admin can pause/rotate the relayer but cannot withdraw.
- **Events are notifications, not proof.** Dev 3 verifies finalized tx + account/token state first.
- **On-chain Promo/Purchase accounts and the vault are authoritative for escrow.** The database is
  a derived record; reconcile and retry, never assume atomicity across Solana/Gemini/Supabase.
- **Gemini is read-only.** Never place orders. If official settlement is unavailable, leave
  resolution pending (or use a clearly labeled manual demo fixture).
- **QuickNode is infrastructure**, not an outcome oracle.
- **Trusted relayer** (MVP) validates the exact market's official outcome and signs `resolve_promo`
  once. Production oracle/dispute design is out of scope.

## Lifecycle

Cancellation creates a refund entitlement; the customer pulls it with `claim_refund`.

- Happy path: `DEPOSITED → PENDING_HEDGE → HEDGE_SIMULATED → HEDGED → RESOLVED → CLAIMED`
- Failure: `… → HEDGE_FAILED → CANCEL_PENDING → CANCELLED → REFUNDED`

`REFUNDED`/`CLAIMED` only after the on-chain claim is verified. Diagrams, transition tables and
race analysis: [workflow.md](workflow.md). Ownership: [developer-ownership.md](developer-ownership.md).
See `CLAUDE.md` §5 for the workflow and failure policy.
