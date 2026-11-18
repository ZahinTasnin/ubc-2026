# hedging/ (Dev 4)

SIMULATED hedge model (`simulate.ts`, pure functions, tests in `simulate.test.ts`). Nothing here
places an order.

- **Size:** 1 YES contract per $1 of refund, rounded up to 0.01 contracts.
- **Fill:** walk live asks from best price, only at prices <= merchant cap; assumes the book does
  not move and we are the only buyer.
- **Outcomes:** `SIMULATED_FILLED`; `SIMULATED_PARTIAL` + `PARTIAL_FILL` (not covered → retry or
  cancel); `FAILED` with `QUOTE_STALE` / `QUOTE_UNAVAILABLE` / `QUOTE_OVER_CAP` /
  `INSUFFICIENT_LIQUIDITY` / `BUDGET_EXCEEDED`.
- **Settle:** `settleHedge` against an official `MarketOutcome`: YES pays $1/contract to the virtual
  ledger, NO pays 0.

Run tests: `pnpm --filter @hedged/api test`.
