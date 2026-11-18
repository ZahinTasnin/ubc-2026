# desk/ (Dev 4): exposure desk, SIMULATED

Each sale is still priced on its own against the live Gemini book; that per-sale price is what the
shop pays. The desk sits behind those per-sale hedges and decides what the platform actually holds
across **all** shops, per Gemini event (`desk.ts`, pure; `run.ts`, runner):

- **Netting.** On a full-game moneyline only one side can win, so the platform always owes at least
  `m = min(liability per side)`. That part is paid from premiums already collected (only if they
  cover it) and is not hedged. Only `liability - m` is bought. Spreads and totals are never netted
  (several lines can win at once).
- **Lots.** Shortfalls are bought in whole lots (`DESK_LOT_CONTRACTS`, default 10), rounded up so
  the desk is never under-hedged. Excess beyond one lot (opposite flow arrived later) is sold at the
  bid.
- **Result.** `GET /api/desk` shows, per event: liability, target, position and gap per contract,
  premiums collected vs desk cost (= savings), and the platform's result if each side wins
  (`covered` = never negative).

Example (tested): 100 lattes "free if Texas wins" at 92¢ and 60 "free if Arkansas wins" at 9¢.
Hedging every sale costs $487. The desk buys only the 200-contract Texas residual for $184 and is
covered either way (+$3 if Texas wins, +$3 if Arkansas wins). Savings $303.

Runs inside the workers every `DESK_REBALANCE_MS` (default 15 s). All fills are simulated against
the live book and stored in `desk_fills` (`simulated = true`); no Gemini order is ever placed.
