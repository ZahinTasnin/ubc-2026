# Interfaces (PRELIMINARY — agree before coding against them)

Items marked **TODO** are undecided. Keep this file in sync with the program, events, PDA seeds,
API shapes and status lifecycle (CLAUDE.md §12.8).

## Anchor instructions (names from the concept doc)

| Instruction        | Action                                      | Authority                |
| ------------------ | ------------------------------------------- | ------------------------ |
| `initialize_promo` | Create promotion + rules                    | Merchant                 |
| `deposit`          | Lock customer tokens, create Purchase, emit | Customer                 |
| `mark_hedged`      | Record simulated hedge success              | Authorized relayer       |
| `cancel_unhedged`  | Cancel unhedged purchase, refund customer   | Authorized path / policy |
| `resolve_promo`    | Set official YES/NO once                    | Authorized relayer       |
| `claim_refund`     | Return amount to customer on YES            | Customer                 |
| `claim_merchant`   | Pay merchant on NO                          | Merchant                 |

Events: `DepositEvent { purchase, promo, customer, amount }` (declared); `PromotionResolvedEvent`,
`PurchaseCancelledEvent`, optional `PurchaseHedgedEvent` (**TODO**).
PDA seeds, vault model (per-promo vs per-purchase), authorization matrix: **TODO (Dev 2)**.
Amounts are integer base units (6 decimals; `5_000_000` = 5 tokens).

## `@hedged/solana` (browser-safe entry)

`derivePromoPda`, `derivePurchasePda`, `getPurchaseState`, `buildDepositTransaction`,
`buildClaimRefundTransaction`, `buildClaimMerchantTransaction`, `buildInitializePromoTransaction`
— all currently throw `NotImplementedError`.

## `@hedged/solana/server` (server-only)

`verifyDeposit`, `subscribeToDeposits` (dedupe by `(signature, eventIndex)`), `markHedged`,
`cancelUnhedged`, `resolvePromotion` — all stubs. Relayer key is injected by the host process.

## API (apps/api) — all return 501 except `/health`

`GET /health` · `GET /api/markets` · `GET /api/markets/:id/quote` · `POST /api/promotions` ·
`GET /api/promotions/:id` · `GET /api/purchases/:id` · `GET /api/merchants/:id/dashboard`.
Request/response DTOs: **TODO (Dev 3 + Dev 1)**. Never trust client-submitted `HEDGED`,
`REFUNDED`, outcome, or price fields. Never return simulated data as live.

## `@hedged/shared` types

`Promotion`, `Purchase`, `Hedge` (always `simulated: true`), `MarketQuote`, `MarketOutcome`,
`DepositEvent`, `PurchaseStatus`, `HedgeStatus`, plus `OnChainPromoState` / `OnChainPurchaseState`.
Money: integer base units as decimal strings (`TokenBaseUnits`); prices as micro-USD
(`PriceMicroUsd`, `$0.34` = `"340000"`). On-chain vs off-chain fields are in separate sub-objects.

## To agree jointly

IDL/PDA seeds · `DepositEvent` fields · signing/authority model · mint & decimals · purchase IDs and
promo→Gemini market mapping · route DTOs · on-chain↔DB status mapping.
