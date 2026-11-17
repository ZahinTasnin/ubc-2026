# Escrow security review (Dev 2)

Scope: `programs/escrow` as of the 10-instruction implementation. Method: manual review of every
instruction's accounts, constraints, state transitions and token flows, plus adversarial localnet
tests (`tests/escrow/security.test.ts`, and the per-instruction suites). This is an MVP/hackathon
review, **not an audit**. All tokens are valueless Devnet test tokens; production launch blockers
in CLAUDE.md §13 are unchanged.

Spec basis: `CLAUDE.md` §6, `docs/interfaces.md` §1–3, §8. Business rules were **not** changed;
anything that would change one is listed under "Decisions requiring approval".

## Findings, ranked

| ID  | Severity              | Finding                                                                                         | Status                                                                                                                                        |
| --- | --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **High** (deployment) | `initialize_config` could be front-run: first caller becomes admin and picks relayer + mint     | **Fixed**                                                                                                                                     |
| D1  | **High** (trust)      | One relayer key decides outcomes; a compromised/rogue relayer can resolve wrongly, irreversibly | **Accepted MVP risk** (approved: keep single relayer; no multisig/delay/dispute)                                                              |
| D2  | **Medium**            | Funds stuck if the relayer disappears (`Deposited` purchases) or never resolves (hedged)        | **Deposited: fixed** (`cancel_expired_deposit`). **Hedged: accepted** — expiry refunds rejected; late resolution preserved (`D2-PROPOSAL.md`) |
| D3  | **Medium**            | Admin `set_paused` can freeze YES refunds and merchant payouts indefinitely                     | **Accepted MVP risk** (approved: keep pause as is; no expiry/multisig)                                                                        |
| D4  | **Medium**            | Premature resolution: `resolve_promo` had no deadline/time gate; closed deposits immediately    | **Fixed** (approved & implemented)                                                                                                            |
| F2  | **Low**               | Promo creation griefing: attacker pre-creates a future promo's vault ATA, `init` fails          | **Fixed**                                                                                                                                     |
| D5  | **Low**               | Merchant == relayer (or colluding) lets one party resolve NO and claim customers' funds         | Decision / ops control                                                                                                                        |
| D6  | **Low**               | Mint with a freeze authority (real USDC has one) can freeze an escrow vault                     | Documented; mock mint has none                                                                                                                |
| D7  | **Info**              | Purchase/Promo accounts never closed; rent not reclaimed                                        | Deferred per interfaces §1                                                                                                                    |
| D8  | **Info**              | Donations to a vault are unclaimable (admin has no withdrawal power by design)                  | Accepted                                                                                                                                      |

No fund-theft path was found that bypasses the checks below. Severity of D1–D3 is about
**trust and liveness**, not about a bug in the state machine.

## Fixed

### F1 — `initialize_config` front-running (High)

Before: any funded wallet could call `initialize_config` first after deployment, becoming admin
(pause, relayer rotation) and choosing the relayer and mint. The relayer controls hedge status and
outcomes, so this is a full takeover of the trust model.

Fix: `initialize_config` now requires the signer to be the program's **upgrade authority**: it
takes `program` and `program_data` accounts and checks `program.programdata_address() ==
program_data` and `program_data.upgrade_authority_address == admin`. This matches the existing spec
text ("deployer/admin (once)"). It adds two accounts to this one instruction, which only the
deploy/admin script calls (`scripts/init-config.ts`); Dev 3 and Dev 1 do not build it.

Operational consequences: (a) initialize immediately after deploying, with the deployer key;
(b) the deployer key is the admin; if the upgrade authority is revoked before initialization, the
Config can never be created. (c) Transferring the upgrade authority does not change `Config.admin`.

Regression tests: `foundation.test.ts` → "rejects initialization by anyone but the program's
upgrade authority", "…with a program_data account that is not this program's", "…all-zero relayer".

### F2 — vault pre-creation griefing (Low)

Before: the vault is the ATA of the (deterministic) Promo PDA, created with `init`. Anyone could
create that ATA first, so `initialize_promo` for that `(merchant, nonce)` would fail forever.

Fix: `init_if_needed` on the vault (Cargo feature `init-if-needed`). Safe here because the
`associated_token` constraints pin mint and owner to the derived ATA address, and an attacker
cannot set a delegate or close authority on an account owned by a PDA that does not exist yet.
Donated tokens in a pre-created vault are not claimable and do not break accounting.

Regression test: `security.test.ts` → "initialize_promo still succeeds when someone pre-created the
vault ATA" (also asserts no delegate/close authority and exact accounting).

## What was verified (no change needed)

- **PDA signing.** Only `claim_refund` and `claim_merchant` sign as the Promo PDA, through the one
  helper `instructions/payout.rs`. Seeds are re-derived from stored fields (`merchant`,
  `promo_nonce`, `bump`), never from caller input. The Promo account is checked by seeds + owner +
  discriminator before it signs. Destination, vault, mint and token program are all constrained.
- **Fund isolation.** Vault must equal `promo.vault`; the purchase must satisfy `has_one = promo`
  **and** its own seeds; so A's purchase cannot be paid out of B's vault, and B's PDA cannot sign for
  A's vault (tests: "a customer with a valid purchase in promo A cannot drain promo B's vault").
- **Authorization.** Relayer instructions compare the signer to `Config.relayer`; the admin has
  no implicit relayer rights (tested). Claims bind the signer to `purchase.customer` /
  `promo.merchant` and the destination owner to the same wallet, so a signer cannot redirect funds.
  A relayer cannot redirect funds: cancellation only creates an entitlement for the recorded customer.
- **Replay / double claim.** All transitions are one-way; each privileged call fails with a
  distinct `Already*`/`InvalidState` error after success. Concurrent duplicates are serialized by
  the runtime's account write locks: exactly one succeeds (tests: concurrent `claim_refund`,
  `claim_merchant`, and YES-vs-NO `resolve_promo`).
- **Accounting.** `total_paid_out` uses `checked_add`, and every payout requires
  `total_paid_out ≤ total_deposited` and `vault.amount ≥ amount`. Each payout equals exactly the
  purchase's stored `amount`. Invariant `vault ≥ total_deposited − total_paid_out` is asserted in the
  settlement tests after every payout.
- **Account substitution / type confusion.** Promo-as-Purchase, Purchase-as-Promo, wrong config,
  forged config, and substituted token program are all rejected (tests).
- **Races.** `mark_hedged` vs `cancel_unhedged`: mutually exclusive (both need `Deposited`).
  `mark_hedged` vs `resolve_promo`: either the purchase is hedged first, or `mark_hedged` fails
  with `PromoNotActive` and the purchase stays `Deposited` (refund-only). `resolve_promo` is
  one-time.
- **Pause matrix.** One table-driven test asserts the full `docs/interfaces.md` §2 matrix.
- **Arithmetic.** All `u64` additions are checked; release profile has `overflow-checks = true`.
- **Token-2022.** Not supported by design (`Program<Token>`); a Token-2022 mint is rejected.

## Fixed (approved decision): D4 — deposit-deadline enforcement (Medium)

Approved rule: `resolve_promo` is rejected **strictly before** `promo.deposit_deadline` and allowed
**from** the deadline on. Deposits are accepted strictly before it (`now < deadline`, unchanged), so at
every instant exactly one of "deposits open" / "resolution open" holds: no overlap in which a deposit
could race a resolution, and no gap. The rule lives in two pure helpers, `Promo::deposits_open` and
`Promo::resolution_open`, used by `deposit` and `resolve_promo`.

New error `ResolutionTooEarly` (6020). It is checked **after** the `Active` check, so a retry on an
already-resolved promo still reports `AlreadyResolved`; authorization and pause are checked before
timing. Consequences for integrators: a merchant's `deposit_deadline` must not be later than the event
end (resolution cannot happen earlier than the deadline), and Dev 4 must not attempt `resolve_promo`
before it.

Tests: Rust unit tests pin the exact boundary (`deadline−1`, `deadline`, `deadline+1`, and the
no-overlap/no-gap property over a range and at `i64::MIN/MAX`); localnet tests cover far-before
(rejected for YES and NO, promo stays `Active`), after (accepted), other instructions unaffected
before the deadline, deposit-closed-and-resolution-open after the deadline, precedence of
authorization/pause/`AlreadyResolved` over timing. (An on-chain transaction cannot be steered onto an
exact second, which is why the exact boundary is a unit test.)

## Decisions

**D1 — Relayer is a single trusted key that decides outcomes (High, accepted MVP assumption — approved).**
Kept as is: single relayer, no multisig, settlement delay or dispute mechanism; authorization and
rotation (`set_relayer`) preserved.
The contract cannot verify the Gemini outcome. A compromised key can `resolve_promo` wrongly; once
resolved it is final, and with NO the merchant can drain every hedged purchase. Pause blocks resolve
and claims, so a fast admin response limits damage only before resolution/claims.
_Recommend (production):_ (1) a claim delay after resolution (`claimable_at = resolved_at + N`) so
admin can pause before payouts; and/or (2) multisig/threshold relayer; (3) keep the relayer key out
of any merchant's control (see D5). _MVP:_ accept and label as a trusted-relayer demo.

**D2 — Stuck funds (Medium; interfaces §8.2, §8.3) — partially approved and implemented.**
Full reasoning and decision record: `D2-PROPOSAL.md`.

- **Fixed — `Deposited` purchases when the relayer disappears.** New customer-signed
  `cancel_expired_deposit` (the relayer's `cancel_unhedged` is unchanged): `Deposited → Cancelled` once
  `now ≥ purchase.deposited_at + promo.cancel_timeout_secs`, then the normal `claim_refund` cancel path.
  Only the purchase's own customer; only `Deposited`; allowed in any promo state and while paused (it
  returns only the caller's own funds). The timeout (`[1 s, 30 days]`) is admin-set (`initialize_config`,
  `set_cancel_timeout`) and **snapshotted per promo**, so a later admin change cannot alter the term of
  an existing promo. Mutually exclusive with `mark_hedged`/`cancel_unhedged` (all need `Deposited`).
- **Deliberately NOT done — `Hedged` purchases.** An on-chain timeout does not prove the off-chain hedge
  was unwound, so a hedged purchase is **never** cancelled or refunded by timeout. Automatic promo-expiry
  refunds were reviewed and **not approved**; hedged funds stay locked until the relayer resolves, and
  **late resolution stays possible** (there is no resolution deadline). Residual risk: if the relayer
  never resolves, hedged funds stay locked (D1/§8.3 trust assumption). Recommended future route for
  recovering a hedged purchase: the post-hedge returns/unwinding feature in `CLAUDE.md` §14.1.
- **Residual operational risk (stated):** if the hedge ever becomes a _real_ exchange position, one placed
  but not yet attested with `mark_hedged` would be orphaned by a customer timeout-cancel. The backend's
  hedge window must be much shorter than `cancel_timeout_secs`, and it must unwind/void on
  `PurchaseCancelledEvent`. The MVP hedge is simulated, so there is no real exposure.
- **Still open (unchanged):** (c) a lost merchant key blocks `claim_merchant` (`Promo.merchant` is
  immutable); (d) a frozen mint/token account blocks payouts (D6).

**D3 — Admin can freeze payouts (Medium, accepted MVP risk — approved).** Pause blocks YES refunds and
merchant claims for as long as the admin wishes (it never moves funds; cancel-path refunds stay open).
Kept as is: no automatic expiry, no multisig; cancelled-purchase refunds stay allowed while paused.
_Production recommendation:_ multisig/timelock for the admin key and a capped pause duration.

(Test names "D2a", "D2b", "D3" in `security.test.ts` characterize behavior that still holds: a `Deposited`
purchase at resolution is refund-only (now also customer-recoverable after the timeout), hedged funds stay
locked without a resolution, and pause can freeze hedged payouts. The old "D4" characterization was
replaced by the enforced-rule test; "D2b" remains correct because late resolution is preserved.)

**D5 — Role separation (Low).** Nothing prevents `merchant == relayer`, or the admin and relayer being
the same key. _Recommend:_ operationally separate keys; optionally reject `initialize_promo` when
`merchant == config.relayer` (does not cover later rotation).

**D6 — Freezable mints (Low).** The mock mint is created with no freeze authority (the script warns
otherwise). For any real stablecoin, a freeze authority can freeze a vault; accepted production risk.

**D7/D8 — Rent and donations (Info).** Closing Purchase accounts (returning rent to the customer)
and a donation-sweep are deferred; sweeping would add an admin withdrawal path, which the spec forbids.

## Interface notes for integrators

See `INTEGRATION.md` for the exact error mapping. `initialize_config` needs `program` and
`program_data` (F1) and now takes a second argument, `cancel_timeout_secs`. D4 adds `ResolutionTooEarly`
(6020); D2 adds `TimeoutNotElapsed` (6021) and `InvalidTimeout` (6022), two instructions
(`cancel_expired_deposit`, `set_cancel_timeout`), and appends `cancel_timeout_secs` (i64) to the `Config` and
`Promo` accounts (no field moved; nothing is deployed yet, so no migration).
