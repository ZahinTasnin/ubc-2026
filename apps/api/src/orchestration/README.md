# orchestration/ (Dev 4)

`orchestrator.ts` drives each purchase through the state machine in `docs/workflow.md`, using only
`SolanaServerGateway` (no web3.js / Anchor here) and the read-only Gemini adapter.

| Entry point                                      | When to call                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `handleDeposit(event)`                           | verified `DepositEvent` from `subscribeToDeposits`                        |
| `processPurchase(pda)`                           | advance one purchase (idempotent; safe after restart)                     |
| `resolveDuePromotions()`                         | timer: promos past `deposit_deadline` with an **official** Gemini outcome |
| `handleResolution(event)` / `handleClaim(event)` | resolution / claim subscriptions                                          |
| `reconcilePromotion(id)`                         | timer + on boot: align DB with `listPurchases`, resume mid-flight work    |

`fake-gateway.ts` is an **in-memory fake** of the gateway (not Solana) used by the tests until
Dev 3's real `@hedged/solana/server` exists. Not wired into `server.ts` yet.

## CLAUDE.md §5.1 coverage (simulated hedge; `orchestrator.test.ts`, in-memory store)

Tested: duplicate deposit / restart → one hedge, no re-quote · bounded backoff + jitter, retryable vs
permanent errors · `TX_TIMEOUT` → re-read before resend · filled / partial / failed / voided paths ·
stop new hedges after 70% of the promo's `cancelTimeoutSecs` · on-chain re-check before hedging ·
`HEDGED` only after a `mark_hedged` receipt · customer-cancel race → hedge `VOIDED`, budget released,
no relayer cancel · relayer `cancelUnhedged` only after live exposure is voided · reconciliation
repairs or flags mismatches · resolution only after the deadline and only from
`gemini-official-settlement`.

Not yet verified: the SQL constraints/functions in `supabase/migrations` against a real database
(the tests use `MemoryStore`), and anything against the real gateway / Devnet.
