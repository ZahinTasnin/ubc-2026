# Workflow and state machines

Two separate state spaces: **on-chain** (authoritative for funds) and **Supabase** processing
states (derived). Field/instruction details: [interfaces.md](interfaces.md).

## Checkout, hedge, settlement (happy path)

```mermaid
sequenceDiagram
  participant C as Customer wallet (Dev 1 UI)
  participant P as Escrow program (Dev 2)
  participant G as Solana infra / gateway (Dev 3)
  participant B as Backend (Dev 4)
  participant M as Gemini (read-only)
  C->>P: deposit(purchase_id, 5_000_000) -> vault, Purchase=Deposited, DepositEvent
  G->>G: detect via QuickNode, verify FINALIZED tx + account/token state
  G->>B: verified DepositEvent (handler)
  B->>B: insert purchase DEPOSITED (unique event id) -> PENDING_HEDGE
  B->>M: GET quote / depth (read-only)
  B->>B: simulate hedge, persist simulated_hedges (unique per purchase) -> HEDGE_SIMULATED
  B->>G: markHedged(purchasePda)
  G->>P: mark_hedged (relayer signs) -> Purchase=Hedged, HedgeMarkedEvent
  G-->>B: TxReceipt (confirmed, state re-read)
  B->>B: status HEDGED -> merchant may fulfill
  Note over B,M: event ends AND now >= deposit_deadline (earlier: ResolutionTooEarly)
  B->>M: official finalized outcome of the exact market
  B->>G: resolvePromotion(promoPda, YES|NO)
  G->>P: resolve_promo (relayer) -> Promo=ResolvedYes|No, ResolutionEvent
  C->>P: claim_refund (YES)  /  merchant -> claim_merchant (NO), ClaimEvent
  G->>B: verified ClaimEvent -> CLAIMED
```

A backend callback cannot mutate Solana state: the backend asks the gateway, which builds and signs
the `mark_hedged` transaction with the server-side relayer key. The purchase is **not HEDGED** until
the gateway returns a confirmed receipt.

## Hedge failure → cancel → refund

```mermaid
sequenceDiagram
  participant B as Backend (Dev 4)
  participant G as Gateway (Dev 3)
  participant P as Escrow program
  participant C as Customer wallet
  B->>B: quote over cap / stale / illiquid / partial / unavailable -> HEDGE_FAILED
  B->>G: cancelUnhedged(purchasePda) (status CANCEL_PENDING)
  G->>P: cancel_unhedged (relayer) -> Cancelled, PurchaseCancelledEvent
  G-->>B: TxReceipt -> CANCELLED (refundable; void any simulated hedge)
  C->>P: claim_refund -> Refunded (tokens to customer ATA), ClaimEvent
  G->>B: verified ClaimEvent / verifyTransaction -> REFUNDED
```

Cancellation creates an entitlement; the customer pulls the refund. `REFUNDED` is set only after
the refund transaction is verified.

## On-chain state machines

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Deposited: deposit (customer)
  Deposited --> Hedged: mark_hedged (relayer, promo Active)
  Deposited --> Cancelled: cancel_unhedged (relayer)
  Deposited --> Cancelled: cancel_expired_deposit (customer, after deposited_at + cancel_timeout)
  Cancelled --> Refunded: claim_refund (customer)
  Hedged --> ClaimedByCustomer: claim_refund (customer, ResolvedYes)
  Hedged --> ClaimedByMerchant: claim_merchant (merchant, ResolvedNo)
```

Promo: `Active → ResolvedYes | ResolvedNo` via `resolve_promo` (once, relayer, only at/after
`deposit_deadline`). Terminal purchase states: `Refunded`, `ClaimedByCustomer`, `ClaimedByMerchant`.
`Hedged` cannot be cancelled (by the relayer **or** by any timeout);
`Cancelled` cannot be hedged; every payout leaves its purchase in a terminal state in the same
instruction (no double claim).

## Backend (Supabase) status machine — Dev 4

```mermaid
stateDiagram-v2
  [*] --> DEPOSITED: verified DepositEvent
  DEPOSITED --> PENDING_HEDGE
  PENDING_HEDGE --> HEDGE_SIMULATED: simulation persisted
  PENDING_HEDGE --> HEDGE_FAILED
  HEDGE_SIMULATED --> HEDGED: mark_hedged receipt
  HEDGE_SIMULATED --> HEDGE_FAILED: mark_hedged gave up / promo resolved
  PENDING_HEDGE --> CANCELLED: customer timeout-cancel observed on chain
  HEDGE_SIMULATED --> CANCELLED: customer timeout-cancel observed on chain (orphaned hedge: reconcile/unwind)
  HEDGE_FAILED --> CANCEL_PENDING
  CANCEL_PENDING --> CANCELLED: cancel_unhedged receipt
  CANCELLED --> REFUNDED: claim_refund verified
  HEDGED --> RESOLVED: promo resolved
  RESOLVED --> CLAIMED: claim verified
```

| Backend status    | On-chain state at that time      | Set when                                       |
| ----------------- | -------------------------------- | ---------------------------------------------- |
| `DEPOSITED`       | Deposited                        | verified deposit recorded                      |
| `PENDING_HEDGE`   | Deposited                        | worker leased the purchase                     |
| `HEDGE_SIMULATED` | Deposited                        | simulated hedge persisted, mark_hedged pending |
| `HEDGED`          | Hedged                           | mark_hedged receipt                            |
| `HEDGE_FAILED`    | Deposited                        | simulation failed / mark_hedged abandoned      |
| `CANCEL_PENDING`  | Deposited (or already Cancelled) | cancel_unhedged requested                      |
| `CANCELLED`       | Cancelled                        | cancel_unhedged receipt                        |
| `REFUNDED`        | Refunded                         | refund tx verified                             |
| `RESOLVED`        | Hedged                           | promo resolved on-chain                        |
| `CLAIMED`         | ClaimedByCustomer / ByMerchant   | claim tx verified                              |

## Idempotency and races

- **Hedge simulation is persisted once**: `simulated_hedges` has a unique key on `purchase_id`.
  Retrying `markHedged` reuses the stored hedge and never re-quotes or double-counts premium/budget.
  Budget/exposure is reserved in the same transaction that inserts the hedge.
- **`mark_hedged` vs `cancel_unhedged` vs `cancel_expired_deposit`**: all need `Deposited` and write
  the same Purchase account, so the runtime serializes them: exactly one succeeds; the others fail
  `INVALID_STATE` (or `AlreadyCancelled`/`AlreadyHedged` for same-target retries). Backend reacts by
  re-reading state (`getPurchaseState`) and aligning the DB, never by assuming. If a cancel wins, the
  simulated hedge becomes `VOIDED` **only after any executed hedge exposure is accounted for**
  (CLAUDE.md §5.1): a customer's timeout cancel can land after the hedge executed but before
  `mark_hedged` confirmed, leaving orphaned exposure that the contract cannot see.
- **Customer timeout cancel**: allowed once `deposited_at + promo.cancel_timeout_secs` has passed
  (Devnet default 600 s), only for a still-`Deposited` purchase, in any promo state and while paused.
  The backend must stop starting hedges well before that deadline (CLAUDE.md §5.1).
- **`mark_hedged` vs `resolve_promo`**: `mark_hedged` requires promo `Active` (read-only); if
  resolution lands first, `mark_hedged` fails and the backend cancels instead. `mark_hedged` does
  not write the Promo account, so it never contends with deposits.
- **Resolution** is once-only on-chain and only at/after `deposit_deadline` (before it:
  `ResolutionTooEarly`, retry later); repeated calls with the same outcome → `alreadyApplied`,
  a conflicting one → `INVALID_STATE` (alert an operator).
- **Unknown outcome of a send** (`TX_TIMEOUT`): re-read on-chain state before retrying.
