# Escrow integration reference (Dev 2 → Dev 3, Dev 4, Dev 1)

Source of truth: `programs/escrow/idl/escrow.json` (+ `escrow.ts`), regenerated with `anchor build`
and copied after every interface change. This file is generated from that IDL plus the contract's
semantics. Program ID: `E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr` (check `declare_id!`, the IDL
`address`, and `pnpm escrow:check`). Interface spec: `docs/interfaces.md` (see "Inconsistencies" below).

The IDL exposes **12 instructions, 3 accounts (`Config`, `Promo`, `Purchase`), 5 events, 23 error
codes**. `pnpm escrow:check` asserts the instructions, accounts and events. (Timeout recovery of `Deposited` purchases, decision D2, is implemented as `cancel_expired_deposit` +
`set_cancel_timeout`; automatic expiry of **hedged** purchases was explicitly not approved and does not exist.)

## PDAs (final)

| Account    | Seeds                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| `Config`   | `["config"]`                                                            |
| `Promo`    | `["promo", merchant, promo_nonce u64 LE]`                               |
| `Purchase` | `["purchase", promo, customer, purchase_id [u8;16]]`                    |
| Vault      | ATA(owner = `Promo` PDA, mint = `Config.mint`), off-curve owner allowed |

Amounts are `u64` base units (6 decimals; `5_000_000` = 5 tokens); timestamps `i64` unix seconds.

## What Dev 3 calls

**Server-only, relayer-signed (`SolanaServerGateway`):** `mark_hedged`, `cancel_unhedged`,
`resolve_promo`. The signer must equal `Config.relayer`; the fee payer may be the relayer.

| Gateway call                       | Instruction       | Returns `alreadyApplied` when program error is…                                   | `INVALID_STATE` when…                                                                                            |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `markHedged(purchase)`             | `mark_hedged`     | `6009 AlreadyHedged`                                                              | `6002 InvalidState` (purchase was cancelled), `6007 PromoNotActive` (promo resolved, purchase still `Deposited`) |
| `cancelUnhedged(purchase)`         | `cancel_unhedged` | `6010 AlreadyCancelled`                                                           | `6002 InvalidState` (purchase is hedged/claimed)                                                                 |
| `resolvePromotion(promo, outcome)` | `resolve_promo`   | `6008 AlreadyResolved` **and** re-read `Promo.state` equals the requested outcome | `6008` with a **different** stored outcome (one error code covers both: always re-read state)                    |

**`resolve_promo` precondition (D4):** it fails with `6020 ResolutionTooEarly` before
`Promo.depositDeadline`, and succeeds from that instant on (`now ≥ deadline`; deposits are accepted only
while `now < deadline`). This is **not** an `alreadyApplied` or `INVALID_STATE` case: it is retryable
once the deadline passes, so the backend should schedule resolution at/after the deadline (and the
gateway should map `6020` to a retryable error, e.g. `TX_FAILED` with `retryable: true`, or a dedicated
code). Merchants/UI must therefore set `deposit_deadline` no later than the event end. Order of checks:
authorization (`6000`) → pause (`6001`) → already resolved (`6008`) → timing (`6020`).

**Customer timeout cancellation (D2, approved scope).** `cancel_expired_deposit` is **wallet-signed by the
purchase's customer** (browser-safe builder for Dev 1 via `@hedged/solana`; the backend never signs it). It
moves a still-`Deposited` purchase to `Cancelled` once `now ≥ purchase.depositedAt + promo.cancelTimeoutSecs`
(inclusive), after which the customer uses the existing `claim_refund` cancel path. Errors: `6021
TimeoutNotElapsed` (retry later; not a conflict), `6010 AlreadyCancelled` (done already), `6002 InvalidState`
(the purchase is hedged or settled: a **hedged purchase can never be cancelled by timeout**), `6000
Unauthorized` (not the purchase's customer). Allowed in any promo state and while paused. It races
`mark_hedged`/`cancel_unhedged` (all need `Deposited`): a relayer `markHedged` that loses the race gets
`6002 InvalidState` → `INVALID_STATE`, so the gateway must re-read the purchase and the backend must treat
it as cancelled (void the simulated hedge). `set_cancel_timeout` and `initialize_config`'s new
`cancel_timeout_secs` argument are admin/ops only (`pnpm escrow:init-config`, env `CANCEL_TIMEOUT_SECS`,
default 600 s).

After any `Already*`/`TX_TIMEOUT`, **re-read the account** and decide from state, never from the
error alone. `6001 Paused` → `PAUSED` (`mark_hedged`/`resolve_promo` blocked; `cancel_unhedged`
still allowed). `6000 Unauthorized` → `NOT_AUTHORIZED`. Anchor `3012 AccountNotInitialized` →
`ACCOUNT_NOT_FOUND`.

**Browser-safe builders (wallet-signed, for Dev 1 via `@hedged/solana`):** `initialize_promo`,
`deposit`, `claim_refund`, `claim_merchant`. Admin-only (`initialize_config`, `set_paused`,
`set_relayer`) are run by scripts/ops, not the app. State reads: `Config`, `Promo`, `Purchase`
accounts via the IDL; `listPurchases(promo)` = `getProgramAccounts` with a memcmp on the `promo`
field (offset 8, the first field of `Purchase`).

Claims are **not** relayer-signed: the backend can only observe them (`subscribeToClaims`,
`verifyTransaction`).

### Instruction accounts (generated from the IDL, in IDL order)

#### `cancel_expired_deposit` — Customer wallet (own purchase, after timeout)

Args: —

| #   | Account    | Signer | Writable |
| --- | ---------- | ------ | -------- |
| 0   | `customer` | yes    |          |
| 1   | `config`   |        |          |
| 2   | `promo`    |        |          |
| 3   | `purchase` |        | yes      |

#### `cancel_unhedged` — **Relayer (Dev 3 server)**

Args: —

| #   | Account    | Signer | Writable |
| --- | ---------- | ------ | -------- |
| 0   | `relayer`  | yes    |          |
| 1   | `config`   |        |          |
| 2   | `promo`    |        |          |
| 3   | `purchase` |        | yes      |

#### `claim_merchant` — Merchant wallet

Args: —

| #   | Account                  | Signer | Writable |
| --- | ------------------------ | ------ | -------- |
| 0   | `merchant`               | yes    |          |
| 1   | `config`                 |        |          |
| 2   | `promo`                  |        | yes      |
| 3   | `purchase`               |        | yes      |
| 4   | `mint`                   |        |          |
| 5   | `vault`                  |        | yes      |
| 6   | `merchant_token_account` |        | yes      |
| 7   | `token_program`          |        |          |

#### `claim_refund` — Customer wallet

Args: —

| #   | Account                  | Signer | Writable |
| --- | ------------------------ | ------ | -------- |
| 0   | `customer`               | yes    |          |
| 1   | `config`                 |        |          |
| 2   | `promo`                  |        | yes      |
| 3   | `purchase`               |        | yes      |
| 4   | `mint`                   |        |          |
| 5   | `vault`                  |        | yes      |
| 6   | `customer_token_account` |        | yes      |
| 7   | `token_program`          |        |          |

#### `deposit` — Customer wallet

Args: `purchase_id: [u8;16]`, `amount: u64`

| #   | Account                  | Signer | Writable |
| --- | ------------------------ | ------ | -------- |
| 0   | `customer`               | yes    | yes      |
| 1   | `config`                 |        |          |
| 2   | `promo`                  |        | yes      |
| 3   | `mint`                   |        |          |
| 4   | `purchase`               |        | yes      |
| 5   | `customer_token_account` |        | yes      |
| 6   | `vault`                  |        | yes      |
| 7   | `token_program`          |        |          |
| 8   | `system_program`         |        |          |

#### `initialize_config` — Admin = deployer (upgrade authority), once

Args: `relayer: pubkey`, `cancel_timeout_secs: i64`

| #   | Account          | Signer | Writable |
| --- | ---------------- | ------ | -------- |
| 0   | `admin`          | yes    | yes      |
| 1   | `program`        |        |          |
| 2   | `program_data`   |        |          |
| 3   | `config`         |        | yes      |
| 4   | `mint`           |        |          |
| 5   | `system_program` |        |          |

#### `initialize_promo` — Merchant wallet

Args: `promo_nonce: u64`, `offer_amount: u64`, `deposit_deadline: i64`, `market_id: string`

| #   | Account                    | Signer | Writable |
| --- | -------------------------- | ------ | -------- |
| 0   | `merchant`                 | yes    | yes      |
| 1   | `config`                   |        |          |
| 2   | `mint`                     |        |          |
| 3   | `promo`                    |        | yes      |
| 4   | `vault`                    |        | yes      |
| 5   | `token_program`            |        |          |
| 6   | `associated_token_program` |        |          |
| 7   | `system_program`           |        |          |

#### `mark_hedged` — **Relayer (Dev 3 server)**

Args: —

| #   | Account    | Signer | Writable |
| --- | ---------- | ------ | -------- |
| 0   | `relayer`  | yes    |          |
| 1   | `config`   |        |          |
| 2   | `promo`    |        |          |
| 3   | `purchase` |        | yes      |

#### `resolve_promo` — **Relayer (Dev 3 server)**

Args: `outcome: Outcome`

| #   | Account   | Signer | Writable |
| --- | --------- | ------ | -------- |
| 0   | `relayer` | yes    |          |
| 1   | `config`  |        |          |
| 2   | `promo`   |        | yes      |

#### `set_cancel_timeout` — Admin

Args: `cancel_timeout_secs: i64`

| #   | Account  | Signer | Writable |
| --- | -------- | ------ | -------- |
| 0   | `admin`  | yes    |          |
| 1   | `config` |        | yes      |

#### `set_paused` — Admin

Args: `paused: bool`

| #   | Account  | Signer | Writable |
| --- | -------- | ------ | -------- |
| 0   | `admin`  | yes    |          |
| 1   | `config` |        | yes      |

#### `set_relayer` — Admin

Args: `new_relayer: pubkey`

| #   | Account  | Signer | Writable |
| --- | -------- | ------ | -------- |
| 0   | `admin`  | yes    |          |
| 1   | `config` |        | yes      |

Notes: `config` (seeds), `system_program`, `token_program` (classic SPL Token only; Token-2022 is
rejected), and `associated_token_program` are fixed addresses. For `claim_*`, the destination token
account must be owned by the signer and of the promo's mint; it **may be any** such token account,
not only the ATA (interfaces.md says "ATA"; builders should default to the ATA).
`initialize_config` needs `program` (the escrow program ID) and `program_data` (its upgradeable-loader
ProgramData PDA) and the signer must be the program's **upgrade authority**.

## Error codes (Anchor numbering: 6000 + enum order, append-only)

| Code | Name               | Code | Name                   |
| ---- | ------------------ | ---- | ---------------------- |
| 6000 | Unauthorized       | 6010 | AlreadyCancelled       |
| 6001 | Paused             | 6011 | AlreadyClaimed         |
| 6002 | InvalidState       | 6012 | MarketIdTooLong        |
| 6003 | WrongMint          | 6013 | MathOverflow           |
| 6004 | WrongTokenAccount  | 6014 | InvalidOfferAmount     |
| 6005 | DepositClosed      | 6015 | InvalidDeadline        |
| 6006 | WrongAmount        | 6016 | EmptyMarketId          |
| 6007 | PromoNotActive     | 6017 | WrongDecimals          |
| 6008 | AlreadyResolved    | 6018 | InvalidRelayer         |
| 6009 | AlreadyHedged      | 6019 | InsufficientVaultFunds |
| 6020 | ResolutionTooEarly |      |                        |
| 6021 | TimeoutNotElapsed  |      |                        |
| 6022 | InvalidTimeout     |      |                        |

Settled purchases (`Refunded`, `ClaimedBy*`) return `6011 AlreadyClaimed` from both claim
instructions. `ConstraintSeeds` (2006) means a purchase was paired with the wrong promo.

## What Dev 4 monitors (via verified `SolanaServerGateway` events)

Each instruction emits **exactly one** event, so `eventIndex` is 0 per instruction (a transaction
that batches several escrow instructions has several). Events are notifications; the gateway verifies
the finalized tx and account state first.

| Event                    | Emitted by                                        | Fields (Rust)                                                                                           | Backend meaning                                                                      |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DepositEvent`           | `deposit`                                         | promo, purchase, customer, purchase_id `[u8;16]`, amount, deposited_at                                  | record `DEPOSITED`, start hedge                                                      |
| `HedgeMarkedEvent`       | `mark_hedged`                                     | promo, purchase, relayer, marked_at                                                                     | confirms `HEDGED` (backend already knows via its receipt; useful for reconciliation) |
| `PurchaseCancelledEvent` | `cancel_unhedged` **or** `cancel_expired_deposit` | promo, purchase, customer, amount, cancelled_at                                                         | `CANCELLED`; refund now claimable by the customer                                    |
| `ResolutionEvent`        | `resolve_promo`                                   | promo, outcome `Outcome{Yes,No}`, relayer, resolved_at                                                  | promo `RESOLVED`; hedged purchases become claimable                                  |
| `ClaimEvent`             | `claim_refund`, `claim_merchant`                  | promo, purchase, recipient, amount, kind `ClaimKind{CancelRefund,YesRefund,MerchantPayout}`, claimed_at | `CancelRefund` → `REFUNDED`; `YesRefund`/`MerchantPayout` → `CLAIMED`                |

Status mapping to set **only after verification**: `Deposited→DEPOSITED`, `Hedged→HEDGED`,
`Cancelled→CANCELLED`, `Refunded→REFUNDED`, `ClaimedByCustomer|ClaimedByMerchant→CLAIMED`.
On-chain `Promo`/`Purchase` accounts are authoritative for escrow; reconcile with `listPurchases`.
Decide from account state, not event order (`ClaimEvent` may arrive before `DepositEvent` is processed).

Anchor event decoding: names in the IDL are PascalCase (`DepositEvent`); the TS `BorshEventCoder`
returns names in that IDL form or camelCase depending on version, so compare case-insensitively.
`Outcome`/`ClaimKind` decode as `{ yes: {} }`, `{ cancelRefund: {} }` etc. → map to `"YES"`,
`"CANCEL_REFUND"`.

## Business rules the integrators must respect

- Do not fulfill before `HEDGED` (off-chain rule; not enforced on-chain).
- **Hedge execution, retries and reconciliation (Dev 4) — PENDING, see the section below and
  `CLAUDE.md` §5.1.** Not implemented or verified by Dev 2 or Dev 3.
- A hedge confirmed after promo resolution fails (`PromoNotActive`): cancel instead.
- A purchase still `Deposited` when the promo resolves is refund-only (it can never be paid to the merchant):
  the relayer can cancel it at any time, and its customer can cancel it after the timeout.
- `resolve_promo` is final; verify Gemini's official outcome and the exact `market_id` first.
- `resolve_promo` is only possible from `deposit_deadline` on (D4, `6020 ResolutionTooEarly` before).
  Choose each promo's `deposit_deadline` no later than the event end.
- Approved MVP decisions: single trusted relayer (D1), customer timeout cancel for **unhedged** purchases
  only (D2; hedged purchases are never refunded by timeout, late resolution stays possible), existing admin
  pause (D3), deposit-deadline enforcement (D4). Post-hedge merchandise returns are post-MVP
  (`CLAUDE.md` §14.1). Remaining items: `SECURITY.md` D5–D8.

## Dev 3 handoff: Solana integration (actionable; implementation is PENDING with Dev 3)

> Nothing here is implemented by Dev 2 or verified in `packages/solana`. This is the contract Dev 3 builds against.

1. **IDL.** Use `programs/escrow/idl/escrow.json` (+ `escrow.ts` types) with the Anchor 0.32.1 TS client:
   `new Program(idl, provider)`; the program ID is `idl.address`. Instruction/account names are camelCase in
   TS (`cancelExpiredDeposit`, `setCancelTimeout`, `program.account.config|promo|purchase`). Re-copy the IDL
   after every `anchor build` that changes the interface; the committed copy equals the build output
   (`pnpm escrow:check`).
2. **PDAs** (seeds in the table above; `promo_nonce` is u64 **little-endian**, `purchase_id` is exactly 16
   bytes, the vault is `getAssociatedTokenAddressSync(mint, promoPda, true)` with `allowOwnerOffCurve`):
   ```ts
   const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
   const [promo] = PublicKey.findProgramAddressSync(
     [Buffer.from("promo"), merchant.toBuffer(), u64le(nonce)],
     programId,
   );
   const [purchase] = PublicKey.findProgramAddressSync(
     [Buffer.from("purchase"), promo.toBuffer(), customer.toBuffer(), purchaseId16],
     programId,
   );
   ```
3. **Who signs what** (fee payer = the signer unless a sponsor is added later):

   | Instruction                                                            | Signer                  | Built by                                | Rent / notes                                                                                                   |
   | ---------------------------------------------------------------------- | ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
   | `initialize_promo`                                                     | merchant                | browser-safe builder                    | merchant pays Promo + vault rent; pass the vault ATA, `Config.mint`, token + associated-token programs         |
   | `deposit`                                                              | customer                | browser-safe builder                    | customer pays Purchase rent; amount must equal `promo.offerAmount`; the UI generates the 16-byte `purchase_id` |
   | `cancel_expired_deposit`                                               | the purchase's customer | browser-safe builder                    | only after `purchase.depositedAt + promo.cancelTimeoutSecs`; `Deposited` only                                  |
   | `claim_refund`                                                         | the purchase's customer | browser-safe builder                    | destination: a token account owned by the customer with the promo mint (use the ATA)                           |
   | `claim_merchant`                                                       | `promo.merchant`        | browser-safe builder                    | one purchase per transaction; destination owned by the merchant                                                |
   | `mark_hedged`, `cancel_unhedged`, `resolve_promo`                      | `Config.relayer`        | **server-only** (`SolanaServerGateway`) | key loaded from `RELAYER_KEYPAIR_PATH`, never in a browser bundle                                              |
   | `initialize_config`, `set_paused`, `set_relayer`, `set_cancel_timeout` | admin = deployer        | ops scripts, **not** the app SDK        | `programs/escrow/scripts`                                                                                      |

4. **Claim / cancellation flows to support.** Hedge failed: relayer `cancelUnhedged` → customer `claim_refund`
   (`CancelRefund`). Relayer silent: customer `cancel_expired_deposit` (after the timeout) → customer
   `claim_refund`. YES: customer `claim_refund` per hedged purchase (`YesRefund`). NO: merchant
   `claim_merchant` per hedged purchase (`MerchantPayout`). A hedged purchase can **never** be cancelled.
   Expose a pure helper `canTimeoutCancel(purchase, promo, chainNowSeconds)` = `state == Deposited &&
purchase.depositedAt + promo.cancelTimeoutSecs <= chainNow`, using **cluster time** (block time of a recent
   slot), not the local clock.
5. **Error handling** (program errors are final for that attempt; never blindly resend):

   | Program error                                                                          | Gateway meaning                                                                                        | Retry?                                             |
   | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
   | `6009 AlreadyHedged` / `6010 AlreadyCancelled` / `6008 AlreadyResolved` (same outcome) | `alreadyApplied: true` after re-reading state                                                          | no                                                 |
   | `6002 InvalidState`                                                                    | `INVALID_STATE`: re-read the purchase/promo and attach the current state to the error                  | no (caller decides)                                |
   | `6007 PromoNotActive` (`markHedged` after resolution)                                  | `INVALID_STATE`                                                                                        | no                                                 |
   | `6020 ResolutionTooEarly`                                                              | retryable error **after** `Promo.depositDeadline` (carry the deadline); do not map to `alreadyApplied` | yes, later                                         |
   | `6021 TimeoutNotElapsed`                                                               | retryable error after `depositedAt + cancelTimeoutSecs`                                                | yes, later                                         |
   | `6001 Paused`                                                                          | `PAUSED`                                                                                               | after unpause                                      |
   | `6000 Unauthorized`                                                                    | `NOT_AUTHORIZED`                                                                                       | no                                                 |
   | `3012 AccountNotInitialized`                                                           | `ACCOUNT_NOT_FOUND`                                                                                    | no                                                 |
   | RPC error, blockhash expired, dropped tx                                               | `RPC_UNAVAILABLE` / `BLOCKHASH_EXPIRED`                                                                | yes (resend-safe), bounded with backoff and jitter |
   | no confirmation before `timeoutMs`                                                     | `TX_TIMEOUT` = **outcome unknown** → re-read account state before any retry                            | only after re-read                                 |

   Simulate before sending to surface program errors early, and resend only when the failure is provably
   resend-safe (blockhash expiry, RPC failure). State is the source of truth, not the error text.

6. **`mark_hedged` vs customer cancellation race.** After any failure or timeout of `markHedged`, re-read the
   purchase: `Hedged` → `alreadyApplied` (receipt with `signature: null` if the original is unknown);
   `Cancelled`/`Refunded` → throw `INVALID_STATE` **with the observed state** (the customer's
   `cancel_expired_deposit` or a relayer cancel won) so Dev 4 flags the executed hedge as orphaned exposure;
   still `Deposited` → the send did not land: safe to retry within the backend's hedge window. Do the
   same for `cancelUnhedged` (`Hedged` → `INVALID_STATE`).
7. **Events.** Decode the five Anchor events from the IDL; each instruction emits exactly one. A
   `PurchaseCancelledEvent` may come from the relayer **or** the customer (identical payload): if the
   initiator matters, take it from the transaction's signers. Verify the finalized transaction and account
   state before delivering (events are notifications, not proof). Handle `ClaimEvent.kind` values
   `CancelRefund`, `YesRefund`, `MerchantPayout` and tolerate additional future variants.
8. **Shared types to update (flagged for the owners of `packages/shared`):** `OnChainConfig` and
   `OnChainPromoAccount` need `cancelTimeoutSecs`; add `buildCancelExpiredDepositTransaction` to the
   browser-safe SDK surface; add a `cancelExpiredDeposit` flow to the status docs.

## Dev 4 handoff: hedge execution, idempotency and the cancel timeout (PENDING)

> **Status: PENDING.** These are requirements for Developer 4 (`CLAUDE.md` §5.1 is the normative text);
> none of it is implemented or verified. The MVP places no real orders (Gemini is read-only), so "hedge
> order" means the simulated hedge today and any real order post-MVP. Do not mark an item done without code
> and a test.

**What the contract gives you (facts to rely on, all read from chain):**

| Need                               | On-chain fact                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cancel deadline for a purchase | `Purchase.depositedAt + Promo.cancelTimeoutSecs` (the timeout is **per promo**, snapshotted at `initialize_promo`; the default set by `pnpm escrow:init-config` is **600 s**, tests use seconds; never hardcode 600) |
| Is it still eligible to hedge?     | `Purchase.state == Deposited` **and** `Promo.state == Active` and not paused (`mark_hedged` is blocked while paused). Re-read **before** placing the hedge.                                                          |
| Idempotency key                    | the Purchase PDA address (unique per deposit; also `purchase_id` + customer)                                                                                                                                         |
| Who can end the `Deposited` state  | the relayer (`mark_hedged`, `cancel_unhedged`) **or the customer** after the timeout (`cancel_expired_deposit`); all mutually exclusive, first one wins                                                              |

**Behaviours Dev 4 must implement (summary; details and checklist in `CLAUDE.md` §5.1):**

1. **Idempotent hedge:** one hedge per Purchase PDA, enforced by a DB unique key created _before_ any
   external call; duplicate deposit events, retries and restarts reuse it.
2. **Retries:** bounded, exponential backoff + jitter; retryable (timeout, 429, 5xx) vs permanent;
   native client-order-ID where available; never blindly resubmit when execution status is unknown.
3. **Reconciliation:** after a timeout, look the order up before retrying; handle pending / partial /
   filled / failed / cancelled; persist state across restarts; if the API cannot guarantee idempotency or
   reliable lookup, never auto-resubmit an ambiguous order.
4. **Timeout margin:** stop starting new hedges early enough before `depositedAt + cancelTimeoutSecs` for
   execution **plus** `mark_hedged` **plus** confirmation (suggested start: last ~30% of the window); the
   customer may cancel at the deadline even if your hedge is in flight.
5. **Never assume off-chain success ⇒ on-chain `Hedged`.** Submit `markHedged` promptly and set `HEDGED`
   only after the gateway receipt. Gateway outcomes: `alreadyApplied` (`6009 AlreadyHedged`) = done;
   `INVALID_STATE` (`6002`, purchase `Cancelled`) = the customer (or the relayer) won the race;
   `TX_TIMEOUT` = unknown → re-read the purchase first.
6. **Lost race / permanent confirmation failure** (hedge executed, purchase `Cancelled`): the position is
   **orphaned exposure** → flag for reconciliation/unwind; do not silently void or abandon it.
7. **`cancelUnhedged` only with proof of no exposure** (no order placed, or all orders confirmed
   failed/cancelled with zero fills, or fully unwound); otherwise flag manually. Remember the customer's
   timeout cancel can happen on its own, so ambiguous cases need fast manual handling.
8. **Reconcile continuously:** compare `listPurchases(promo)` against the persisted hedge table; repair or
   alert on every mismatch.

**Ownership:** Dev 4 = hedge execution, retries, idempotency, reconciliation. Dev 3 = Solana transaction
integration; coordinates confirmation failures with Dev 4 (typed `SolanaGatewayError`, `alreadyApplied`,
`TX_TIMEOUT`). Dev 2 = the Anchor program that enforces the purchase states and the timeout cancellation;
it performs **no** API retries, order handling or reconciliation.

## Interface audit (docs vs program vs IDL)

**Fixed in this audit (documentation/config only; shared files are flagged for the owners' review):**

- `docs/interfaces.md`: 12-instruction table with args, signers, pause behavior and time rules; full error
  table (6000–6022) and check order; `Config`/`Promo` fields including `cancel_timeout_secs`; events note
  that `PurchaseCancelledEvent` has two emitters; gateway timing/race notes; new browser-safe builder; the
  decided-vs-open business rules.
- `docs/workflow.md` (state machine, backend status edges, races, resolution timing), `docs/setup.md`,
  `docs/developer-ownership.md` (Dev 2 and the pending Dev 4 requirements), `README.md` (status, commands).
- `.env.example`: `RELAYER_PUBLIC_KEY` now correctly refers to `Config.relayer`; added the Dev 2 script
  variables and `CANCEL_TIMEOUT_SECS=600`.
- `CLAUDE.md`: repo layout, §5.1 (pending Dev 4 requirements), §6 (12 instructions, timeout, race and risks).
- Program source comments (`state`, `events`, `lib.rs`) updated; IDL regenerated (doc strings only).

**Still flagged — implementation code owned by others (not edited here):**

1. `packages/shared`: `OnChainConfig`/`OnChainPromoAccount` lack `cancelTimeoutSecs`; `ClaimKind`, events and
   seeds already match the contract (checked by reading).
2. `packages/solana`: stubs only; needs the builders and gateway behavior in the Dev 3 section above.
3. `apps/api`/`supabase`: the Dev 4 requirements (CLAUDE.md §5.1) and the `CANCELLED`-from-customer
   transitions; the `PENDING_HEDGE`/`HEDGE_SIMULATED → CANCELLED` edges in `docs/workflow.md`.
4. Root `package.json` holds Dev 2 tooling (`escrow:*` scripts, Anchor-test devDependencies): shared file.
5. ATA wording: the contract accepts any token account owned by the signer with the right mint for
   deposits and claims; interfaces now say so (stricter ATA-only enforcement would be a rule change; not done).
