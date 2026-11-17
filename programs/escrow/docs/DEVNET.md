# Devnet deployment checklist (Dev 2) — NOT YET DEPLOYED

Devnet only. All tokens are valueless test tokens. Never use mainnet: the Dev 2 scripts refuse a
mainnet RPC outright, and refuse any non-Devnet RPC unless `ALLOW_NON_DEVNET=1` (for a local
validator). Never commit keypairs; every key below lives **outside the repo**.

Nothing in this file has been executed against Devnet. The scripts were exercised against a local
validator only (see "Verification status").

## 0. Tool versions this repo was built with

`anchor-cli 0.32.1`, `solana-cli 3.0.11`, `cargo 1.98` (host), SBF toolchain `platform-tools v1.51`
(rustc 1.84, which is why `Cargo.lock` is committed and pinned — see `docs/setup.md`; do not run a
blanket `cargo update`). Node ≥ 22, pnpm 10.

## 1. Keys and who needs what

| Key             | Purpose                                                                                                                       | Where                                                                         | Notes                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Deployer wallet | pays deploy, becomes the **upgrade authority**, and is the only key that can run `initialize_config` → becomes `Config.admin` | `~/.config/solana/id.json` (Anchor.toml `provider.wallet`)                    | Treat as the admin key. Back it up.                                                                                                       |
| Program keypair | fixes the program ID                                                                                                          | `target/deploy/escrow-keypair.json` (gitignored)                              | Must match `declare_id!`. If lost, the program ID changes everywhere. Back it up **out-of-band** and share it with whoever deploys.       |
| Relayer keypair | signs `mark_hedged`/`cancel_unhedged`/`resolve_promo`                                                                         | e.g. `~/.config/solana/relayer.json` = `RELAYER_KEYPAIR_PATH`                 | **Separate from the deployer/admin and from any merchant** (SECURITY.md D5). Needs ~1 SOL for fees. Only its public key goes into Config. |
| Mint keypair    | stable address for the mock mint (optional)                                                                                   | `~/.config/hedged/mock-usd-mint.json` (created by the mint script, mode 0600) | Not secret in effect (the mint authority is the payer), but keep it outside the repo.                                                     |

```bash
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/relayer.json   # once
solana-keygen pubkey ~/.config/solana/relayer.json                          # public key only
```

## 2. Program ID and configuration (verified locally)

`declare_id!` in `programs/escrow/src/lib.rs`, both `[programs.*]` entries in `Anchor.toml`, the IDL
`address`, and `target/deploy/escrow-keypair.json` all equal
`E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr` on the machine that built it. **Re-verify on the
deploying machine:**

```bash
anchor build
pnpm escrow:check            # offline: ids, IDL == build output, 10 ix / 3 accounts / 5 events, .so, rent estimate
```

If the keypair is missing on another machine, do **not** deploy: `anchor build` will generate a new
keypair (a different program ID). Obtain the original, or consciously re-key: `anchor keys sync`, then
update `Anchor.toml`, `.env`, `NEXT_PUBLIC_ANCHOR_PROGRAM_ID`, and notify Dev 1/3/4.

`Anchor.toml` defaults to `cluster = "localnet"` (safe for tests). Devnet is always selected
explicitly with `--provider.cluster devnet` below. `[[test.genesis]]` only affects `anchor test`.

## 3. Fund the deployer

`pnpm escrow:check` prints an estimate (≈ 6.0 SOL rent for ProgramData at the CLI's default
`--max-len` of 2× the program, plus a ≈ 3.0 SOL temporary buffer that is refunded, ≈ 9 SOL
transiently for the current ~429 KB build). Confirm with `solana rent <bytes>`. Devnet airdrops are
capped (~2 SOL per request) and rate-limited: use <https://faucet.solana.com> or repeat airdrops.
To cut the cost, pass a smaller `--max-len` (it limits how much larger a later upgrade may be).

```bash
solana balance -u devnet
solana airdrop 2 -u devnet          # repeat / use the web faucet as needed
```

## 4. Pre-flight (read-only, sends nothing)

```bash
pnpm escrow:check --online          # deployer balance vs estimate; "not deployed yet" is expected now
```

## 5. Deploy (run by a human; I did not run this)

```bash
anchor build
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/id.json
# equivalent: solana program deploy target/deploy/escrow.so \
#   --program-id target/deploy/escrow-keypair.json -u devnet -k ~/.config/solana/id.json
```

Immediately afterwards (steps 6–7): until `initialize_config` runs, nobody _else_ can initialize
(only the upgrade authority can), but the program is unusable.

## 6. Mock mint (6 decimals) and test balances

```bash
set -a; source .env; set +a                     # the scripts read the process environment (no dotenv)
MINT_RECIPIENTS="<devWallet1>,<devWallet2>:5000" \
MINT_TOPUP_TOKENS=1000 \
pnpm escrow:mint                                 # add --dry-run first
```

Prints `MOCK_USDC_MINT=<address>`; put it in `.env` (and `NEXT_PUBLIC_MOCK_USDC_MINT`). Re-running
reuses the mint and only tops each recipient **up to** the target (never beyond), so it is safe to
repeat. Customers need their own Devnet SOL for fees and rent; the script mints tokens only.

| Variable                 | Default                               | Meaning                                                                |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| `SOLANA_RPC_URL`         | public Devnet                         | RPC endpoint (only the host is ever printed; QuickNode URLs hold keys) |
| `PAYER_KEYPAIR_PATH`     | `~/.config/solana/id.json`            | fee payer **and mint authority**                                       |
| `MOCK_USDC_MINT`         | —                                     | reuse an existing mint (public address) instead of creating one        |
| `MOCK_MINT_KEYPAIR_PATH` | `~/.config/hedged/mock-usd-mint.json` | stable mint address; created if absent (mode 0600), outside the repo   |
| `MINT_RECIPIENTS`        | —                                     | comma list of `pubkey` or `pubkey:wholeTokens`                         |
| `MINT_TOPUP_TOKENS`      | `1000`                                | default target balance per recipient (whole tokens)                    |
| `ALLOW_NON_DEVNET`       | unset                                 | `1` only for a local validator                                         |

The mint has **no freeze authority** (a freezable mint could freeze an escrow vault).

## 7. Initialize the Config (deployer key, immediately after deploy)

```bash
MOCK_USDC_MINT=<mint> RELAYER_PUBLIC_KEY=<relayer pubkey> CANCEL_TIMEOUT_SECS=600 pnpm escrow:init-config   # --dry-run first
```

Admin = the deployer (must be the upgrade authority; the script checks this before sending). It is
idempotent: if Config exists it only compares and exits `2` on mismatch (relayer is rotated with
`set_relayer`; the mint is immutable). Variables: `ADMIN_KEYPAIR_PATH` (default
`~/.config/solana/id.json`), `MOCK_USDC_MINT`, `RELAYER_PUBLIC_KEY`, `CANCEL_TIMEOUT_SECS` (default 600; 1 s to 30 days;
how long a purchase may sit un-hedged before its customer can cancel it; applies to promos created afterwards,
change later with `set_cancel_timeout`; keep the backend hedge window well below it), optional `ANCHOR_PROGRAM_ID`.

## 8. Verify the deployed program matches the committed IDL

```bash
pnpm escrow:check --online
```

Checks, read-only: program deployed, deployer is the upgrade authority, **deployed ELF bytes ==
`target/deploy/escrow.so`** (and `.so` was built from the same source as the committed
`programs/escrow/idl/escrow.json`, verified offline), and whether Config is initialized. Optional
extra: `solana program dump <id> /tmp-free-path.so -u devnet` and compare with a checksum.
Publishing the IDL on-chain (`anchor idl init -f programs/escrow/idl/escrow.json <id> --provider.cluster devnet`)
is optional; the app uses the committed IDL.

## 9. Hand-off

1. Put `ANCHOR_PROGRAM_ID`, `NEXT_PUBLIC_ANCHOR_PROGRAM_ID`, `MOCK_USDC_MINT`,
   `NEXT_PUBLIC_MOCK_USDC_MINT`, `RELAYER_PUBLIC_KEY` in `.env` (public values only).
2. Give Dev 3 the relayer keypair path convention (`RELAYER_KEYPAIR_PATH`, key stays outside the repo)
   and `INTEGRATION.md`; give Dev 4 the event table in `INTEGRATION.md`.
3. The Anchor test suite is **localnet-only** (it uses airdrops and chain-time waits); do not point
   `anchor test` at Devnet. Smoke-test on Devnet through Dev 3's SDK/Dev 1's UI.

## 10. Upgrades

Same keys, `anchor build`, `anchor upgrade target/deploy/escrow.so --program-id <id> --provider.cluster devnet`
(or `solana program deploy`). If the interface changed: re-run `anchor build`, copy
`target/idl/escrow.json` and `target/types/escrow.ts` to `programs/escrow/idl/`, run
`pnpm escrow:check`, and notify Dev 3 (IDL consumer). Never revoke the upgrade authority before
`initialize_config` has run.

## Verification status (what was and was not checked)

| Item                                                                                 | Status                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------- |
| Program ID consistency (lib.rs, Anchor.toml, IDL, keypair)                           | verified locally by `pnpm escrow:check` |
| IDL exposes 10 instructions / 3 accounts / 5 events                                  | verified (`pnpm escrow:check`)          |
| Mint script (create, idempotent top-up, dry run, cluster guard)                      | exercised on a **local validator** only |
| `init-config` (init, idempotent re-run, mismatch exit code, non-authority rejection) | exercised on a **local validator** only |
| `escrow:check --online` (deployed-bytes comparison)                                  | exercised on a **local validator** only |
| Deployer balance on Devnet, faucet availability, actual deploy                       | **not checked** (no Devnet access used) |
