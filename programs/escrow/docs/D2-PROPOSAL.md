# D2 — timeout-based customer recovery (decisions recorded; Path A implemented, Path B rejected)

## Decision record

| Question                                               | Decision                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 — automatic expiry refunds for **hedged** purchases | **NOT approved.** No `expire_promo`, no `Expired` state, no `resolution_deadline`, no `ExpiredRefund`. Hedged purchases keep waiting for resolution and **late resolution stays possible**.                                                                                   |
| Q2 — source of a resolution timeout                    | Merchant-set per promo was chosen, but it is **moot**: with Q1 rejected there is no resolution timeout.                                                                                                                                                                       |
| Q3 — how customers cancel after the timeout            | **New instruction** `cancel_expired_deposit`, customer-signed. The relayer's `cancel_unhedged` is unchanged. Only the customer's own `Deposited` purchase, only after the timeout; never a `Hedged` purchase. `CLAUDE.md` revised accordingly.                                |
| Q4 — pause                                             | "Allowed while paused" was chosen for the expiry path; applied here to the one path that exists: `cancel_expired_deposit` (and the follow-up cancel-path `claim_refund`) are allowed while paused, like `cancel_unhedged`, because they only return the customer's own funds. |

**Implemented (Path A only):** `cancel_expired_deposit`, `set_cancel_timeout`, `Config.cancel_timeout_secs`,
`Promo.cancel_timeout_secs` (snapshot at `initialize_promo`), errors `TimeoutNotElapsed` /
`InvalidTimeout`. **Not implemented, by decision:** everything in "Path B" below. The proposal text is kept
as the reasoning behind the decision and as a starting point if hedged-purchase recovery is revisited
(the post-hedge returns feature in `CLAUDE.md` §14.1 is the intended route for unwinding a real hedge).

Deliberate narrowing versus the original proposal: Path A (b), "cancel immediately once the promo is
resolved/expired", was **not** implemented because only the timeout path was approved. After resolution a
`Deposited` purchase is still recoverable by the customer after the normal timeout (or by the relayer at
any time).

Timeout parameters (as implemented): `cancel_timeout_secs` is an `i64` in `[1 s, 30 days]`, set by the
admin in `initialize_config` and changed for future promos with `set_cancel_timeout`; each promo snapshots
the value. The proposed default for Devnet/demo is **600 s** (script env `CANCEL_TIMEOUT_SECS`); the
backend's hedge window must stay well under it. Boundary is inclusive: allowed when
`now ≥ deposited_at + timeout`.

Layout/migration flag (implemented): `Config` +8 bytes and `Promo` +8 bytes (`cancel_timeout_secs` appended
at the end of each struct; no field moved), `initialize_config` gained an argument. Nothing is deployed, so
no migration is needed now; deploying an older build first and upgrading would require account
reallocation. Seeds unchanged.

---

_Original proposal below (historical)._

Status of the original text: nothing below changes the single-relayer model (D1) or the admin pause (D3).

## 1. What the contract can and cannot know

An on-chain timeout proves only that time passed. It does **not** prove that an off-chain hedge was
cancelled, unwound, or even that none exists. So every recovery path below is allowed only when one of
these holds, and each emits an on-chain fact the backend must reconcile against:

1. the purchase has **no attested hedge** (`Deposited`: the relayer never confirmed `mark_hedged`), or
2. the exposure shift is a **pre-agreed, publicly visible term fixed at deposit time**, and it is not
   triggerable before the market should have finished.

Where the hedge sits: it is a **merchant-side** position. A customer refund never moves hedge funds; it
only changes **who bears the hedge outcome**. After a refund without resolution:

| Eventual market result | Merchant's hedge payoff | Customer                                           | Merchant's net on this purchase               |
| ---------------------- | ----------------------- | -------------------------------------------------- | --------------------------------------------- |
| YES                    | pays out ($1/contract)  | refunded (as normal on YES)                        | neutral — same as the normal YES flow         |
| NO                     | worthless               | refunded (normally the merchant would keep the $5) | **loses the $5 sale revenue and the premium** |

That NO-case loss is the financial assumption that needs your approval (§3, Q1). It never happens for
Path A.

## 2. Proposed rules

### Path A — `Deposited` purchase, relayer silent (customer cancels)

- **Authority:** `purchase.customer` only.
- **Conditions** (any one):
  - (a) `now ≥ purchase.deposited_at + promo.cancel_timeout_secs`; or
  - (b) the promo is `ResolvedYes|ResolvedNo|Expired` (the purchase can no longer be hedged:
    `mark_hedged` requires an `Active` promo, so it is refund-only anyway).
- **Transition:** `Deposited → Cancelled` (identical to relayer cancellation: same state, same
  `PurchaseCancelledEvent`, no token movement). The customer then uses the **existing** `claim_refund`
  cancel path (already allowed while paused).
- **Why no unaccounted exposure:** `Deposited` means nothing is attested, and the merchant must not
  fulfil before `HEDGED` (off-chain rule), so no goods are owed. Any simulated/real hedge the backend
  created but did not attest is by definition unattested; the backend already voids it when it sees the
  purchase cancelled (`VOIDED`, `docs/workflow.md`).
- **Residual risk (stated, not hidden):** if the hedge becomes a _real_ exchange position, one placed
  but not yet attested would be orphaned by a customer cancel. Mitigation is operational: the backend's
  hedge window `H` must be much shorter than `cancel_timeout_secs` (give up and cancel at `H`), and it
  must unwind on `PurchaseCancelledEvent`. The MVP hedge is simulated, so there is no real exposure.
- **Races:** `mark_hedged` and customer-cancel both need `Deposited`, so exactly one wins; the loser gets
  `InvalidState`/`AlreadyCancelled` and the backend re-reads chain state (existing policy).
- **Pause:** allowed while paused (returns only the caller's own funds).

### Path B — `Hedged` purchases, promo never resolved (promo expiry)

Customers cannot individually claim a hedged purchase before resolution (that would let a customer take
the refund while the outcome is still open). Instead the **whole promo expires** once a pre-agreed
resolution deadline passes:

- **New field `promo.resolution_deadline`** (absolute unix seconds), supplied by the merchant at
  `initialize_promo` and validated against admin bounds:
  `deposit_deadline + min_resolution_grace ≤ resolution_deadline ≤ deposit_deadline + max_resolution_horizon`.
  It is visible on-chain before any customer deposits, and bounded so a merchant cannot lock funds
  forever. (It must be set to the market's end plus a buffer; a timeout measured only from the deposit
  deadline could expire before the event even happens, so it is deliberately an absolute, merchant-declared
  time.)
- **`expire_promo`** — signer: anyone (permissionless; the conditions are deterministic).
  Preconditions: `promo.state == Active` **and** `now ≥ promo.resolution_deadline`.
  Effect: `Active → Expired` (new terminal `PromoState`), `expired_at` set, `PromoExpiredEvent`.
- **After expiry:**
  - `resolve_promo`, `mark_hedged`, `deposit` fail (promo not `Active`); `claim_merchant` fails
    (`InvalidState`), so a refunded customer can never also be paid to the merchant.
  - `claim_refund` on a `Hedged` purchase of an `Expired` promo pays exactly `purchase.amount` to the
    customer (`Hedged → ClaimedByCustomer`, `ClaimKind::ExpiredRefund`).
  - `Deposited` purchases are cancelled by their customer immediately (Path A (b)); `Cancelled` ones
    refund as today.
- **Why this accounts for the exposure:** (1) the term is fixed and visible at deposit time; (2) it cannot
  fire before the merchant-declared resolution time, i.e. the backend had the whole window to resolve;
  (3) `PromoExpiredEvent` is a hard signal for the backend to settle each simulated position as
  `EXPIRED_UNRESOLVED` and unwind any real one; the merchant keeps the position's eventual payoff (YES →
  offsets the refund; NO → worthless, merchant bears it); (4) expiry and resolution are mutually exclusive
  and irreversible, so there is no double settlement.
- **Pause:** recommended **allowed** while paused for `expire_promo` and expired refunds (they return only
  the customer's own funds). This is a small extension of D3's "cancelled refunds stay open while paused"
  and is the only way the timeout guarantee survives a pause (Q4).

Alternatives rejected: keep funds locked forever (status quo, the stated problem); pay the merchant on
expiry (harms customers when the outcome could have been YES); let the admin resolve (breaks D1, adds a
second outcome authority).

## 3. Decisions needed

| #   | Question                                                                    | Recommendation                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | On expiry, refund all customers and let the merchant bear the NO-case loss? | **Yes**                                                                                                                                                                                                                                                                                                                   |
| Q2  | Where does the resolution timeout come from?                                | Merchant-declared per-promo `resolution_deadline`, bounded by admin parameters                                                                                                                                                                                                                                            |
| Q3  | How does a customer cancel on timeout?                                      | New instruction `cancel_timed_out` (keeps the relayer path untouched; **requires updating CLAUDE.md's "no second cancellation instruction" rule**). Alternative: let `cancel_unhedged` accept the customer after the timeout (no new instruction, but its `relayer` account becomes `authority`, an IDL rename for Dev 3) |
| Q4  | Expired-promo refunds while paused?                                         | Allowed                                                                                                                                                                                                                                                                                                                   |

Proposed default values (all set by the admin at `initialize_config`/`set_timeouts`, so localnet tests use
seconds and Devnet/production use real values): `cancel_timeout_secs` = **600** (10 min; backend hedge
window must stay well under it), `min_resolution_grace` = **3600** (1 h), `max_resolution_horizon` =
**30 days**.

## 4. Footprint if approved

| Area              | Change                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Config`          | + `cancel_timeout_secs`, `min_resolution_grace_secs`, `max_resolution_horizon_secs` (3 × i64, +24 B)                                                                                                                                                                                             |
| `Promo`           | + `cancel_timeout_secs` (snapshot, so a later admin change cannot shorten an existing promo's term), `resolution_deadline`, `expired_at` (3 × i64, +24 B); `PromoState::Expired` appended (existing variant values unchanged)                                                                    |
| Instructions      | **new:** `cancel_timed_out` (Q3), `expire_promo`, `set_timeouts` (admin, allowed while paused). **changed signature:** `initialize_config` (+3 args), `initialize_promo` (+`resolution_deadline`). **changed behavior:** `claim_refund` (Hedged purchase on an Expired promo). Others unchanged. |
| Events            | **new** `PromoExpiredEvent { promo, expired_by, expired_at }`; `ClaimKind::ExpiredRefund` appended; `PurchaseCancelledEvent` reused                                                                                                                                                              |
| Errors (appended) | `TimeoutNotElapsed`, `ResolutionDeadlineNotReached`, `InvalidTimeout`, `InvalidResolutionDeadline`                                                                                                                                                                                               |
| PDA seeds         | **unchanged**                                                                                                                                                                                                                                                                                    |

**Migration / reallocation flag:** the layouts of the existing `Config` and `Promo` accounts change. Nothing
is deployed yet, so this is free now (rebuild and regenerate the IDL). After a Devnet deploy it would need
account reallocation or a redeploy with fresh accounts. **Approve D2 before deploying** to avoid that.

Shared-interface impact (flagged, not edited): `OnChainConfig`/`OnChainPromoAccount`/`OnChainPromoState`/
`ClaimKind` in `@hedged/shared` (new fields/variants), `docs/interfaces.md` §1–3, `.env`-level admin
parameters, Dev 3's `initialize_promo` builder (new arg) and event decoder (new variants), Dev 4's
status mapping (`EXPIRED_UNRESOLVED`), Dev 1's merchant form (resolution deadline input).

## 5. Test plan (after approval)

Timeout boundaries (pure-function unit tests for exact `before / at / after`, plus integration tests with
real waits); unauthorized callers (relayer/merchant/other customers cannot cancel a customer's purchase
via the timeout path; merchant cannot expire early); replay and double claim (second cancel, second
expire, second refund); pause behavior for each new instruction; `expire_promo` vs `resolve_promo`
race (exactly one wins; the loser fails); expired promo blocks `deposit`/`mark_hedged`/`resolve_promo`/
`claim_merchant`; a resolved promo can never be expired; parameter-bound validation; fund conservation
(`vault == total_deposited − total_paid_out`) across expiry flows; customer cancel vs `mark_hedged` race.
