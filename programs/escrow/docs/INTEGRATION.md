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
- **Hedge window vs cancel timeout (Dev 4):** keep the hedge window (simulate + `markHedged` + confirmation)
  well below `cancel_timeout_secs` (`Promo.cancelTimeoutSecs`, default 600 s). After
  `depositedAt + cancelTimeoutSecs` the customer can cancel a still-`Deposited` purchase themselves; stop
  hedging attempts before then and, on any observed `PurchaseCancelledEvent` (relayer **or** customer),
  void the simulated hedge (`VOIDED`). A customer cancellation looks identical to a relayer one in the event
  (the transaction signer differs).
- A hedge confirmed after promo resolution fails (`PromoNotActive`): cancel instead.
- A purchase still `Deposited` when the promo resolves is refund-only; only the relayer can cancel it.
- `resolve_promo` is final; verify Gemini's official outcome and the exact `market_id` first.
- `resolve_promo` is only possible from `deposit_deadline` on (D4, `6020 ResolutionTooEarly` before).
  Choose each promo's `deposit_deadline` no later than the event end.
- Approved MVP decisions: single trusted relayer (D1) and the existing admin pause (D3) stay as they are.
- Open decision that would add instructions/fields/layout changes: **D2** timeout recovery, see
  `D2-PROPOSAL.md` (not implemented; decide before any Devnet deploy). Lower-priority items: `SECURITY.md` D5–D8.

## Inconsistencies / gaps found against `docs/interfaces.md` and shared files

These are **flagged, not edited** (shared or other developers' files):

1. **`initialize_config` accounts changed** (adds `program`, `program_data`; admin must be the upgrade
   authority). `docs/interfaces.md` §2 already says "deployer/admin (once)" but does not list accounts.
2. **No error-code table** in `docs/interfaces.md`; the gateway mapping above should be added there.
   Codes are append-only; seven were added since the skeleton (`InvalidOfferAmount`, `InvalidDeadline`,
   `EmptyMarketId`, `WrongDecimals`, `InvalidRelayer`, `InsufficientVaultFunds`, and now
   `ResolutionTooEarly` for D4).
   `docs/interfaces.md` §2 should also state that `resolve_promo` requires `now ≥ deposit_deadline`.
3. **ATA wording:** interfaces §1/§2 say deposit/claim use the customer/merchant **ATA**; the
   contract accepts any token account owned by the signer with the right mint (stricter alternative:
   require the ATA; would be a behavior change).
4. **`.env.example`:** `RELAYER_PUBLIC_KEY` comment says "must match `Promo.relayer`"; the relayer is
   stored in **`Config.relayer`** (there is no `Promo.relayer`). Also missing (used by the Dev 2
   scripts, read from the process environment, not auto-loaded): `PAYER_KEYPAIR_PATH`,
   `ADMIN_KEYPAIR_PATH`, `DEPLOYER_KEYPAIR_PATH`, `MOCK_MINT_KEYPAIR_PATH`, `MINT_RECIPIENTS`,
   `MINT_TOPUP_TOKENS`, `ALLOW_NON_DEVNET`.
5. **New shared-interface surface from D2/D4 (flagged, not edited):** `docs/interfaces.md` §2 needs two
   instruction rows (`set_cancel_timeout`, `cancel_expired_deposit`), the `resolve_promo` deadline rule, and
   the `initialize_config(relayer, cancel_timeout_secs)` signature; `@hedged/shared` `OnChainConfig` and
   `OnChainPromoAccount` need `cancelTimeoutSecs`; `README.md` instruction lists need the same sync
   (CLAUDE.md §12.8). `CLAUDE.md` itself was updated (cancellation rule, authority table, §14 roadmap).
   5b. **Outcome on resolution:** `docs/interfaces.md` §4 `resolvePromotion(…, "YES"|"NO")` — the
   gateway must pass `{ yes: {} }` / `{ no: {} }` for `Outcome`.
6. **Root `package.json`** gained Anchor-test devDependencies and three `escrow:*` scripts (Dev 2
   tooling) — shared file, needs owners' review.
7. `packages/solana` and `packages/shared` match the contract's seeds, states, events and field names
   (checked by reading); `OnChainConfig`/`OnChainPurchaseAccount` omit `bump` (fine, internal).
