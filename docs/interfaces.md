# Interfaces (FINAL for architecture; field-level details change only via PR to this file)

Keep this file, `programs/escrow/src/{state,events}`, `packages/shared`, and CLAUDE.md in sync
(CLAUDE.md §12.8). Lifecycle, state machines and race analysis: [workflow.md](workflow.md).

## 1. Escrow architecture

**One token vault per promotion, one Purchase PDA per deposit.** Funds are pooled; liabilities are
tracked per purchase. Token = mock USD SPL mint, **6 decimals** (`5_000_000` = 5 tokens). All
amounts are `u64` base units with checked arithmetic.

| Account    | Seeds (PDA of the escrow program)                     | Notes                                                            |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `Config`   | `["config"]`                                          | admin, relayer (one), mint, `paused`                             |
| `Promo`    | `["promo", merchant, promo_nonce: u64 LE]`            | also the **vault authority** (no separate authority account)     |
| Vault      | ATA(owner = Promo PDA, mint), off-curve owner allowed | the single pooled token account; address stored in `Promo.vault` |
| `Purchase` | `["purchase", promo, customer, purchase_id: [u8;16]]` | `purchase_id` = client-generated UUIDv4 bytes                    |

`purchase_id` is unique per deposit, so one customer can make many purchases; including
`customer` in the seeds stops another wallet squatting someone's id. TS constants: `PDA_SEEDS`
(`@hedged/shared`); helpers: `deriveConfigPda`, `derivePromoPda`, `derivePurchasePda`,
`deriveVaultAddress` (`@hedged/solana`, Dev 3).

**`Promo` fields:** merchant, mint, vault, promo_nonce, offer_amount (every deposit must equal it),
deposit_deadline (i64), market_id (≤ 64 bytes, exact Gemini market), state
(`Active | ResolvedYes | ResolvedNo`), resolved_at, `total_deposited`, `total_paid_out`,
`purchase_count`, bump. Max YES price and hedge budget are **off-chain** policy (Dev 4).

**`Purchase` fields:** promo, customer, purchase_id, amount, state, deposited_at, hedged_at,
cancelled_at, settled_at, bump. `PurchaseState`: `Deposited | Hedged | Cancelled | Refunded |
ClaimedByCustomer | ClaimedByMerchant`.

**Accounting rules (per-purchase liabilities in a shared vault)**

- `deposit`: `amount == promo.offer_amount`; `total_deposited += amount`; transfer customer ATA →
  vault (mint, owner and destination checked).
- Every payout (`claim_refund`, `claim_merchant`) pays **exactly `purchase.amount`** from the vault,
  signed by the Promo PDA, only if the purchase is in the matching un-settled state, and moves it to
  a terminal state in the same instruction; `total_paid_out += amount`. A purchase can therefore
  never take more than its own `amount`, and only once (terminal states are one-way).
- Invariants: `total_paid_out ≤ total_deposited`; `vault balance ≥ total_deposited − total_paid_out`
  (equality unless tokens are donated to the vault); Σ amount of non-terminal purchases =
  `total_deposited − total_paid_out`. Admin has **no** withdrawal instruction.
- Purchase accounts are not closed in the MVP (rent reclaim deferred).

## 2. Instructions, authority, and pause

| Instruction         | Transition                                                                                         | Signer / authority                               | Pausable?                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `initialize_config` | creates Config                                                                                     | deployer/admin (once)                            | —                                             |
| `set_paused`        | toggles `Config.paused`                                                                            | admin                                            | no                                            |
| `set_relayer`       | rotates the single relayer key                                                                     | admin                                            | no                                            |
| `initialize_promo`  | creates Promo + vault ATA                                                                          | merchant wallet                                  | **blocked**                                   |
| `deposit`           | creates Purchase `Deposited`                                                                       | customer wallet; promo `Active`; before deadline | **blocked**                                   |
| `mark_hedged`       | Purchase `Deposited → Hedged`                                                                      | relayer; promo `Active`                          | **blocked**                                   |
| `cancel_unhedged`   | Purchase `Deposited → Cancelled`                                                                   | relayer; any promo state                         | **allowed**                                   |
| `resolve_promo`     | Promo `Active → ResolvedYes\|ResolvedNo` (once)                                                    | relayer                                          | **blocked**                                   |
| `claim_refund`      | `Cancelled → Refunded` (any promo state) **or** `Hedged → ClaimedByCustomer` (promo `ResolvedYes`) | `purchase.customer`; dest ATA owned by customer  | cancel path **allowed**, YES path **blocked** |
| `claim_merchant`    | `Hedged → ClaimedByMerchant` (promo `ResolvedNo`)                                                  | `promo.merchant`; dest ATA owned by merchant     | **blocked**                                   |

Pause rationale: pause stops anything that can open new liabilities or pay merchants/resolve (a
compromised relayer or program bug), while keeping the two paths that can only return a purchase's
own funds to its own customer (`cancel_unhedged` → `claim_refund`). The relayer can never redirect
funds: cancellation only creates a refund entitlement for `purchase.customer`, and every payout
destination is constrained to the recorded customer/merchant and the configured mint.

All privileged instructions are retry-safe: re-sending after the target state holds fails with a
distinct error (`AlreadyHedged`, `AlreadyCancelled`, `AlreadyResolved`, `AlreadyClaimed`) which the
gateway maps to `alreadyApplied` (same outcome) or `INVALID_STATE` (conflicting transition).

## 3. Anchor events

Events are **notifications, not proof of payment**. Dev 3 verifies the finalized transaction
(success, program ID, mint, accounts, amounts) and the resulting account/token state before
delivering anything to Dev 4. Signature, slot, block time and event index are attached
**off-chain** (`ChainPosition`), not stored in payloads. u64 → decimal string in TS; i64 → number.

| Event                    | Emitted by                       | Fields (Rust types)                                                                                                          |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DepositEvent`           | `deposit`                        | promo `Pubkey`, purchase `Pubkey`, customer `Pubkey`, purchase_id `[u8;16]`, amount `u64`, deposited_at `i64`                |
| `HedgeMarkedEvent`       | `mark_hedged`                    | promo, purchase, relayer `Pubkey`, marked_at `i64`                                                                           |
| `PurchaseCancelledEvent` | `cancel_unhedged`                | promo, purchase, customer `Pubkey`, amount `u64`, cancelled_at `i64`                                                         |
| `ResolutionEvent`        | `resolve_promo`                  | promo `Pubkey`, outcome `Outcome{Yes,No}`, relayer `Pubkey`, resolved_at `i64`                                               |
| `ClaimEvent`             | `claim_refund`, `claim_merchant` | promo, purchase, recipient `Pubkey`, amount `u64`, kind `ClaimKind{CancelRefund,YesRefund,MerchantPayout}`, claimed_at `i64` |

Separate `HedgeMarkedEvent` / `PurchaseCancelledEvent` are **kept**: they let the reconciler
and dashboards see relayer actions without diffing accounts. The backend still confirms its own
relayer calls through the gateway receipt, not by waiting for these events.

TS mapping (`@hedged/shared` `events.ts`): each event → interface of the same name
(`extends ChainPosition`), snake_case → camelCase, `Pubkey` → `Base58`, `[u8;16]` →
`PurchaseIdHex` (32 hex chars), `Outcome` → `"YES"|"NO"`, `ClaimKind` → `"CANCEL_REFUND"|…`.
`ProgramEvent` is the discriminated union returned by `verifyTransaction`.

**Dedup id:** `chainEventId = "${signature}:${eventIndex}"` (index among this program's decoded
events in the tx). Backend stores it unique (`depositEventId` is a deprecated alias).

**Finality:** the listener delivers at the configured commitment (MVP: `finalized`, env
`SOLANA_FINALITY`). Nothing is processed from a WebSocket notification alone.

**Missed / duplicated / reordered events**

- Delivery is at-least-once; handlers are idempotent (unique `chainEventId`, state-guarded
  transitions) and **decide from on-chain state** (`getPurchaseState`), never from event order.
- Missed (disconnect/restart): the host persists the last acked slot and resubscribes with
  `fromSlot`; additionally Dev 4 runs a periodic reconciliation with `listPurchases(promo)` /
  `getPromoState` and repairs any purchase whose DB status lags on-chain state.
- Reordered (e.g. `ClaimEvent` before the `DepositEvent` was processed): process by reading the
  account; an event for an unknown purchase triggers a fetch, not a failure.

## 4. `SolanaServerGateway` (`@hedged/shared` `solana-gateway.ts`; implemented by Dev 3)

```ts
interface SolanaServerGateway {
  subscribeToDeposits(
    h: EventHandler<DepositEvent>,
    o?: { fromSlot?: number },
  ): Promise<Unsubscribe>;
  subscribeToResolutions(h: EventHandler<ResolutionEvent>, o?): Promise<Unsubscribe>;
  subscribeToClaims(h: EventHandler<ClaimEvent>, o?): Promise<Unsubscribe>;

  markHedged(purchasePda, opts?: SubmitOptions): Promise<TxReceipt>;
  cancelUnhedged(purchasePda, opts?: SubmitOptions): Promise<TxReceipt>;
  resolvePromotion(promoPda, outcome: "YES" | "NO", opts?: SubmitOptions): Promise<TxReceipt>;

  getConfig(): Promise<OnChainConfig | null>;
  getPromoState(promoPda, commitment?): Promise<OnChainPromoAccount | null>;
  getPurchaseState(purchasePda, commitment?): Promise<OnChainPurchaseAccount | null>;
  listPurchases(promoPda, commitment?): Promise<OnChainPurchaseAccount[]>;
  verifyTransaction(signature, commitment?): Promise<TxVerification>;
}
```

- `TxReceipt { signature: string | null; slot: number | null; commitment; alreadyApplied }`. A
  receipt means the tx reached the commitment **and** the state was re-read and matches. Backend
  marks `HEDGED`/`CANCELLED` only after receiving one.
- `SubmitOptions { commitment?, timeoutMs? }`. The gateway resends only resend-safe failures
  (blockhash expiry, RPC errors) within `timeoutMs`.
- **Errors:** `SolanaGatewayError { code, retryable, signature? }`; codes `RPC_UNAVAILABLE`,
  `TX_TIMEOUT` (outcome unknown: re-read state before retrying), `BLOCKHASH_EXPIRED`,
  `ACCOUNT_NOT_FOUND`, `INVALID_STATE`, `PAUSED`, `NOT_AUTHORIZED`, `VERIFICATION_FAILED`,
  `TX_FAILED`; `GATEWAY_ERROR_RETRYABLE` gives the default retry policy.
- **Idempotency:** same-target-state calls resolve with `alreadyApplied: true`; conflicting
  transitions throw `INVALID_STATE` (e.g. `cancelUnhedged` on a `Hedged` purchase, or
  `resolvePromotion` with a different outcome).
- **Subscriptions:** verified events only, at-least-once, ack by resolving the handler, redelivery
  on throw, `fromSlot` replay; handlers idempotent (see §3).
- The relayer key is loaded server-side by Dev 3's module (`RELAYER_KEYPAIR_PATH`); Dev 4 only
  calls this interface. Customer/merchant-signed instructions (`deposit`, claims,
  `initialize_promo`) are built by browser-safe helpers in `@hedged/solana` and signed in wallets.
  Dev 4 can only observe claims (`subscribeToClaims`, `verifyTransaction`).

## 5. Browser-safe SDK (`@hedged/solana`, Dev 3 → Dev 1)

`deriveConfigPda`, `derivePromoPda`, `derivePurchasePda`, `deriveVaultAddress`, `getPromoState`,
`getPurchaseState`, `buildInitializePromoTransaction`, `buildDepositTransaction`,
`buildClaimRefundTransaction`, `buildClaimMerchantTransaction` — all `NotImplementedError` stubs
(signatures for PDA helpers/reads are typed). Wallet requirements: customer signs `deposit` and
`claim_refund` (pays Purchase rent + fees), merchant signs `initialize_promo` and `claim_merchant`;
ATAs must be for the configured mint (6 decimals); the UI generates `purchase_id` (16 random bytes).

## 6. API (apps/api, Dev 4 → Dev 1) — all 501 except `/health`

`GET /health` · `GET /api/markets` · `GET /api/markets/:id/quote` · `POST /api/promotions` ·
`GET /api/promotions/:id` · `GET /api/purchases/:id` · `GET /api/merchants/:id/dashboard`.
Request/response DTOs: **TODO (Dev 4 proposes, Dev 1 agrees; put in `@hedged/shared`)**. Never trust
client-submitted `HEDGED`, `REFUNDED`, outcome, or price fields; never return simulated data as live.
Purchase DTOs must expose both the off-chain `status` and the on-chain `state`.

## 7. Shared types (`@hedged/shared`)

`Promotion`, `Purchase`, `Hedge` (always `simulated: true`), `MarketQuote`, `MarketOutcome`,
events (`DepositEvent`, `HedgeMarkedEvent`, `PurchaseCancelledEvent`, `ResolutionEvent`,
`ClaimEvent`, `ProgramEvent`, `ChainPosition`, `chainEventId`), on-chain views (`OnChainConfig`,
`OnChainPromoAccount`, `OnChainPurchaseAccount`), statuses (`OnChainPromoState`,
`OnChainPurchaseState`, `PurchaseStatus`, `HedgeStatus`), `PDA_SEEDS`, `SolanaServerGateway` and
its supporting types. Money: integer base units as decimal strings; prices micro-USD
(`$0.34` = `"340000"`).

## 8. Open business rules (flagged, not invented)

1. **Unhedged purchases at resolution.** Implemented default: `resolve_promo` does not touch
   purchases; a `Deposited` purchase can only be cancelled (→ refund). It can never be paid to the
   merchant. Confirm.
2. **Customer escape hatch.** If the relayer disappears, a `Deposited` purchase is stuck. Options:
   a customer-callable cancel after a timeout, or accept as an MVP limitation. Undecided.
3. **No-resolution deadline.** Funds of hedged purchases stay locked until `resolve_promo`; no
   expiry/fallback is defined (CLAUDE.md §5.7 says "hold funds and signal admin recovery").
4. **Merchant payout granularity.** `claim_merchant` pays one purchase per call (simple, exact
   accounting); batch claims deferred.
5. Merchant-visible rule "do not fulfill before HEDGED" is enforced off-chain (UI/backend), not by
   the contract.
