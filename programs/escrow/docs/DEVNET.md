# Devnet deployment checklist (Dev 2) — NOT YET DEPLOYED

Devnet only. All tokens are valueless test tokens. Never use mainnet: the Dev 2 scripts refuse a
mainnet RPC outright, and refuse any non-Devnet RPC unless `ALLOW_NON_DEVNET=1` (for a local
validator). Never commit keypairs; every key below lives **outside the repo**.

Nothing in this file has been executed against Devnet. The scripts were exercised against a local
validator only (see "Verification status"). **Do not deploy until the remaining decisions at the end of
this file are cleared.**

## At a glance: exact command sequence (copy, replace the `<…>` placeholders)

Run from the repository root, on the machine that holds the program keypair and the deployer wallet.
Keys are referenced by path only; never paste or commit key contents.

```bash
# 0. one-time: separate relayer key (outside the repo), fund fee payers
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/relayer.json
solana config set --url devnet                       # CLI defaults to Devnet (never mainnet)
solana balance                                       # deployer, needs about 10 SOL transiently (see §3)
solana transfer "$(solana-keygen pubkey ~/.config/solana/relayer.json)" 1 --allow-unfunded-recipient

# 1. preflight: secrets, IDs, interface, readiness (all read-only)
git ls-files | grep -iE 'keypair|id\.json|\.env$' || echo "no key-like files tracked"
pnpm escrow:verify-docs && pnpm escrow:check && pnpm escrow:check --online

# 2. build and deploy (the only step that spends SOL and creates the program)
anchor build
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/id.json

# 3. immediately: mock mint (6 decimals) + balances, then Config (600 s timeout, separate relayer)
MINT_RECIPIENTS="<customerPubkey>,<merchantPubkey>:5000" pnpm escrow:mint --dry-run
MINT_RECIPIENTS="<customerPubkey>,<merchantPubkey>:5000" pnpm escrow:mint
MOCK_USDC_MINT=<mint printed above> RELAYER_PUBLIC_KEY="$(solana-keygen pubkey ~/.config/solana/relayer.json)" \
  CANCEL_TIMEOUT_SECS=600 pnpm escrow:init-config --dry-run
MOCK_USDC_MINT=<mint> RELAYER_PUBLIC_KEY=<relayer pubkey> CANCEL_TIMEOUT_SECS=600 pnpm escrow:init-config

# 4. post-deploy verification (read-only)
pnpm escrow:check --online                           # deployed bytes == local build, deployer is authority, Config initialized
MOCK_USDC_MINT=<mint> RELAYER_PUBLIC_KEY=<relayer pubkey> CANCEL_TIMEOUT_SECS=600 pnpm escrow:init-config   # must say "Matches requested values"
solana program show E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr
```

If `RPC` is a QuickNode URL, set `SOLANA_RPC_URL` for the `pnpm` commands (only its host is ever printed) and
`--url <that URL>` for the `solana`/`anchor` commands; the URL contains an API key, so keep it in your
shell/`.env`, never in the repo.

## 0. Tool versions this repo was built with

`anchor-cli 0.32.1`, `solana-cli 3.0.11`, `cargo 1.98` (host), SBF toolchain `platform-tools v1.51`
(rustc 1.84, which is why `Cargo.lock` is committed and pinned — see `docs/setup.md`; do not run a
blanket `cargo update`). Node ≥ 22, pnpm 10.

## 1. Keys and who needs what

| Key             | Purpose                                                                                                                       | Where                                                                         | Notes                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployer wallet | pays deploy, becomes the **upgrade authority**, and is the only key that can run `initialize_config` → becomes `Config.admin` | `~/.config/solana/id.json` (Anchor.toml `provider.wallet`)                    | Treat as the admin key. Back it up.                                                                                                                                                                  |
| Program keypair | fixes the program ID                                                                                                          | `target/deploy/escrow-keypair.json` (gitignored)                              | Must match `declare_id!`. If lost, the program ID changes everywhere. Back it up **out-of-band** and share it with whoever deploys.                                                                  |
| Relayer keypair | signs `mark_hedged`/`cancel_unhedged`/`resolve_promo`                                                                         | e.g. `~/.config/solana/relayer.json` = `RELAYER_KEYPAIR_PATH`                 | **Separate from the deployer/admin and from any merchant** (SECURITY.md D5; `escrow:init-config` refuses a relayer equal to the admin). Needs ~1 SOL for fees. Only its public key goes into Config. |
| Mint keypair    | stable address for the mock mint (optional)                                                                                   | `~/.config/hedged/mock-usd-mint.json` (created by the mint script, mode 0600) | Not secret in effect (the mint authority is the payer), but keep it outside the repo.                                                                                                                |

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
pnpm escrow:check            # offline: ids, IDL == build output, 12 ix / 3 accounts / 5 events, .so, rent estimate
```

If the keypair is missing on another machine, do **not** deploy: `anchor build` will generate a new
keypair (a different program ID). Obtain the original, or consciously re-key: `anchor keys sync`, then
update `Anchor.toml`, `.env`, `NEXT_PUBLIC_ANCHOR_PROGRAM_ID`, and notify Dev 1/3/4.

`Anchor.toml` defaults to `cluster = "localnet"` (safe for tests). Devnet is always selected
explicitly with `--provider.cluster devnet` below. `[[test.genesis]]` only affects `anchor test`.

## 3. Fund the deployer

`pnpm escrow:check` prints an estimate (≈ 6.2 SOL rent for ProgramData at the CLI's default
`--max-len` of 2× the program, plus a ≈ 3.1 SOL temporary buffer that is refunded, ≈ 9.3 SOL
transiently for the current ~443 KB build; the script prints the live figure). Confirm with `solana rent <bytes>`. Devnet airdrops are
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

## 5. Deploy (run by a human; NOT run by Dev 2 tooling)

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

The mint has **no freeze authority** (a freezable mint could freeze an escrow vault); the script warns if it finds one on a reused mint. Test customers/merchants also need their own Devnet SOL (fees, plus rent for the accounts they create); the script mints tokens only. The mint keypair path is refused if it is inside the repository.

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

## Secret handling

- **Never in the repo:** program keypair (`target/deploy/` is gitignored), deployer wallet, relayer keypair,
  mint keypair, `.env`, RPC URLs with keys. `.gitignore` covers `target/`, `.env*`, `*-keypair.json`,
  `id.json`, `relayer*.json`; the mint script additionally refuses a keypair path inside the repository.
- **Verified in this audit:** no key-like file is tracked by git; the ignore rules match the expected
  paths; no tracked text contains a 64-byte key array; the only code that writes secret key material is the
  mint script, to a file outside the repo with mode `0600`; the scripts print public keys, signatures and
  RPC **host names** only.
- **Public by design** (safe to share/put in `.env.example` values): program ID, mint address, relayer
  **public** key, `CANCEL_TIMEOUT_SECS`.
- **Back up out-of-band:** the program keypair and the deployer wallet (loss changes the program ID / locks
  upgrades and `Config.admin` actions).

## Post-deployment verification checklist

| Check                                                      | How                                                | Expect                                                |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Program is live and owned by the upgradeable loader        | `solana program show <id> -u devnet`               | authority = deployer                                  |
| Deployed bytes equal the local build and the committed IDL | `pnpm escrow:check --online`                       | all checks passed                                     |
| Config initialized with the intended values                | re-run `pnpm escrow:init-config` with the same env | "Matches requested values" (exit 0); `2` on any drift |
| Timeout is 600 s                                           | the same re-run with `CANCEL_TIMEOUT_SECS=600`     | no timeout drift reported                             |
| Relayer is separate and funded                             | `solana balance <relayer pubkey> -u devnet`        | ≥ ~0.5 SOL; key ≠ deployer                            |
| Mock mint has 6 decimals and no freeze authority           | `spl-token display <mint> -u devnet`               | decimals 6 and no freeze authority                    |
| Test wallets hold balances                                 | `spl-token accounts --owner <wallet> -u devnet`    | mock USD at the target amounts                        |

## Verification status (what was and was not checked)

| Item                                                                                                | Status                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Program ID consistency (lib.rs, Anchor.toml, IDL, keypair)                                          | verified locally by `pnpm escrow:check`                                                                    |
| IDL exposes 12 instructions / 3 accounts / 5 events; committed IDL equals the build output          | verified (`pnpm escrow:check`)                                                                             |
| Docs/IDL/constants/test-count agreement                                                             | verified (`pnpm escrow:verify-docs --log …`)                                                               |
| Mint script (create, idempotent top-up, dry run, cluster guard)                                     | exercised on a **local validator** only                                                                    |
| `init-config` (init with timeout, idempotent re-run, mismatch exit code 2, non-authority rejection) | exercised on a **local validator** only                                                                    |
| `init-config` relayer==admin refusal; mint keypair-inside-repo refusal                              | exercised on a **local validator**/filesystem only                                                         |
| `escrow:check --online` (deployed-bytes comparison)                                                 | exercised on a **local validator** only                                                                    |
| Mainnet refusal (genesis hash) and non-Devnet refusal without `ALLOW_NON_DEVNET`                    | non-Devnet refusal exercised; the mainnet branch is code-reviewed only (no mainnet access used, by design) |
| Deployer balance on Devnet, faucet availability, QuickNode endpoint, the actual deploy              | **not checked** (no Devnet access used)                                                                    |

## Readiness and what still blocks a deploy

Ready: program, IDL, tests, scripts, checklist, secret handling. **Blockers / decisions before deploying:**
confirm you accept the deployer key as `Config.admin`; have the program keypair backed up; fund the deployer
(~10 SOL on Devnet); choose and fund the separate relayer key; accept that `packages/solana` and `apps/api`
are not implemented yet, so only scripts (not the app) can exercise the program on Devnet.
