# @hedged/solana — Solana infrastructure (Dev 3)

Everything off-chain that talks to the escrow program (`E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr`,
Solana **Devnet**): PDAs, account reads, wallet transaction builders, the relayer-signed
`SolanaServerGateway`, verified event delivery, and the **QuickNode** RPC + **Streams** integration.
The IDL is consumed straight from `programs/escrow/idl/` (Dev 2's committed export); nothing is copied.

| Entry                   | Who uses it        | Safe in the browser? |
| ----------------------- | ------------------ | -------------------- |
| `@hedged/solana`        | `apps/web` (Dev 1) | yes (no keys, no fs) |
| `@hedged/solana/server` | `apps/api` (Dev 4) | **no** (relayer key) |

## Browser-safe SDK (`@hedged/solana`)

```ts
import { Connection } from "@solana/web3.js";
import {
  buildInitializePromoTransaction,
  buildDepositTransaction,
  buildClaimRefundTransaction,
  buildClaimMerchantTransaction,
  buildCancelExpiredDepositTransaction,
  getPromoState,
  getPurchaseState,
  listPurchases,
  getConfigAccount,
  canTimeoutCancel,
  getClusterTime,
  derivePromoPda,
  derivePurchasePda,
  deriveVaultAddress,
  deriveConfigPda,
  newPurchaseId,
} from "@hedged/solana";

const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!, "confirmed");

// Merchant: create a promo (vault created by the program). Keep promoPda.
const promo = await buildInitializePromoTransaction({
  connection,
  merchant: wallet.publicKey.toBase58(),
  depositDeadline: Math.floor(Date.now() / 1000) + 3600, // <= the event end
  marketId: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX", // exact Gemini instrument symbol
});
await wallet.sendTransaction(promo.transaction, connection);

// Customer: pay 5 mock USD into the escrow. Keep purchasePda / purchaseId.
const dep = await buildDepositTransaction({
  connection,
  customer: wallet.publicKey.toBase58(),
  promoPda: promo.promoPda,
});
await wallet.sendTransaction(dep.transaction, connection);

// Later: refund (cancel path or YES path), merchant payout (NO path), or timeout cancel.
await wallet.sendTransaction(
  (await buildClaimRefundTransaction({ connection, purchasePda: dep.purchasePda })).transaction,
  connection,
);
```

Every builder returns `{ transaction, instruction, blockhash, lastValidBlockHeight }` (unsigned
legacy `Transaction`, fee payer = the signer, accounts passed explicitly in IDL order). Reads return
the `@hedged/shared` shapes (`OnChainPromoAccount` / `OnChainPurchaseAccount`, u64 as decimal
strings) plus `cancelTimeoutSecs` on promos and config. `canTimeoutCancel` must be fed
`getClusterTime()` (chain time), not the local clock.

## Server gateway (`@hedged/solana/server`)

`RealSolanaGateway` implements `SolanaServerGateway` exactly as typed in `packages/shared`:

- **`markHedged` / `cancelUnhedged` / `resolvePromotion`**: relayer-signed. Simulate first (program
  errors surface before sending), send with rebroadcast, rebuild only on proven blockhash expiry,
  resolve only after the commitment is reached **and** the account was re-read.
  - Same target already holds → `{ alreadyApplied: true, signature: <original tx if found> }`.
  - Conflicting transition → `GatewayInvalidStateError` (`code: "INVALID_STATE"`, `.observedState`),
    e.g. the customer's timeout cancel won the race against `markHedged`.
  - `resolve_promo` too early (6020) → `ResolutionTooEarlyError` (`code: "TX_FAILED"`,
    `retryable: true`, `.retryAfterUnix` = the deposit deadline).
  - `TX_TIMEOUT` only after re-reading state (if the target state holds, you get a receipt).
  - `6001` → `PAUSED`, `6000` → `NOT_AUTHORIZED`, `3012` → `ACCOUNT_NOT_FOUND`, transport → `RPC_UNAVAILABLE`.
- **Reads**: `getConfig`, `getPromoState` (with live vault balance and `outstanding`),
  `getPurchaseState`, `listPurchases` (memcmp on `Purchase.promo`, offset 8).
- **`verifyTransaction`**: the tx must exist at the commitment, have succeeded and invoked the
  program; every decoded event must agree with account state and token balance deltas (vault
  conservation per tx, customer debit for deposits, recipient credit for claims, mint = `Config.mint`).
  Mismatch → `VERIFICATION_FAILED`.
- **Subscriptions** (`subscribeToDeposits/Resolutions/Claims`): verified events only, at-least-once,
  per-subscriber dedupe by `chainEventId` (`signature:eventIndex`), a throwing handler is redelivered
  with backoff, `fromSlot` replays history after a restart. Signal sources feed one pipeline:
  QuickNode Streams pushes, WebSocket `logsSubscribe`, and an RPC sweep (`getSignaturesForAddress`)
  that fills gaps (dropped sockets, restarts).

```ts
import { createSolanaGatewayFromEnv } from "@hedged/solana/server";
const gateway = await createSolanaGatewayFromEnv(); // reads the env below; refuses mainnet
```

| Env                                       | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `QUICKNODE_RPC_URL` / `_WSS_URL`          | QuickNode Devnet endpoint (preferred; embeds a key, server-only, never logged)     |
| `SOLANA_RPC_URL` / `SOLANA_WS_URL`        | fallback (public Devnet)                                                           |
| `RELAYER_KEYPAIR_PATH`                    | relayer keypair JSON **outside the repo** (`RELAYER_PUBLIC_KEY` is checked if set) |
| `SOLANA_FINALITY`                         | `finalized` (default) or `confirmed`                                               |
| `SOLANA_EVENT_SOURCE`                     | `websocket` (default) or `streams` (QuickNode Streams webhook is the primary feed) |
| `QUICKNODE_STREAMS_SECURITY_TOKEN`        | the Stream's HMAC token (streams mode)                                             |
| `SOLANA_SWEEP_MS`, `SOLANA_TX_TIMEOUT_MS` | gap-filler interval (5 s ws / 30 s streams), privileged-call budget (90 s)         |

## QuickNode Streams (bounty: "Best Use of QuickNode Streams")

QuickNode Streams is the escrow's **primary event feed** in `SOLANA_EVENT_SOURCE=streams` mode:
every deposit, hedge mark, cancellation, resolution and claim reaches the backend because a Stream
pushed it. How the Stream is configured, and why:

| Setting     | Value                                                        | Why                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Network     | `solana-devnet`                                              | the escrow lives on Devnet (valueless test tokens only)                                                                                                                                                                                                                                          |
| Dataset     | `programs_with_logs`                                         | per-transaction program invocations **plus log messages**: Anchor events are emitted as `Program data:` logs, so this is the smallest dataset that carries them                                                                                                                                  |
| Filter      | [`streams/filter.js`](streams/filter.js)                     | keeps only **successful** txs that **invoke the escrow program**; labels the instruction (8-byte Anchor discriminator) and extracts this program's events from the logs while tracking the CPI stack; drops IDL-upload noise; returns `null` for empty batches so nothing is delivered or billed |
| Destination | webhook → `POST /webhooks/quicknode`                         | `handleStreamsWebhook` checks `X-QN-Signature` = HMAC-SHA256(token, nonce + timestamp + body), rejects stale timestamps, gunzips if needed, acks fast                                                                                                                                            |
| Batching    | `dataset_batch_size: 5`, `elastic_batch_enabled: true`       | Solana has sub-second blocks: tip Streams need a batch ≥ 5; elastic batching delivers what is ready instead of waiting                                                                                                                                                                           |
| Delivery    | `max_retry 5`, `retry_interval_sec 2`, `post_timeout_sec 10` | Streams delivers in order and retries until a 2xx, so the receiver only enqueues and returns                                                                                                                                                                                                     |

The Streams payload is a **notification, not proof**: each signature is re-fetched over QuickNode
RPC, held until the configured commitment, and verified against account state and token deltas
before Dev 4's handlers see it. A slow RPC sweep (30 s) backs the Stream up if a delivery is ever
missed. Example filter output for one deposit:

```json
{
  "programId": "E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr",
  "network": "solana-devnet",
  "matchedTransactions": [
    {
      "signature": "5Kq…",
      "slot": 523474333,
      "blockTime": 1794970000,
      "instructions": ["deposit"],
      "events": [{ "index": 0, "name": "DepositEvent", "data": "ePg9Ux+Oa5Ab…" }]
    }
  ]
}
```

The filter was validated on QuickNode's own runtime (`POST /streams/test_filter`, `solana-devnet`,
`programs_with_logs`, slot 523383592): it matched the escrow's `initialize_config` transaction and
nothing else. Locally, `runStreamsFilterLocally` runs the same file in an isolated `vm` for tests.

Create the Stream (idempotent via `external_id`):

```bash
QUICKNODE_API_KEY=... STREAMS_WEBHOOK_URL=https://<public-host>/webhooks/quicknode \
  pnpm --filter @hedged/solana streams:create            # --dry-run to preview, --test-filter to run the filter on QuickNode
```

Receive it without `apps/api` (prints verified events): `pnpm --filter @hedged/solana streams:webhook`
(expose port 4100 with e.g. `ngrok http 4100`).

## Relayer key

The relayer is the only key that can sign `mark_hedged` / `cancel_unhedged` / `resolve_promo`. It
lives outside the repo (`~/.config/solana/…`, mode 600) and only its public key is ever printed.
The admin (Config.admin, the deployer) rotates it, reversibly:

```bash
NEW_RELAYER=<pubkey> ADMIN_KEYPAIR_PATH=~/.config/solana/id.json pnpm --filter @hedged/solana relayer:set --dry-run
NEW_RELAYER=<pubkey> ADMIN_KEYPAIR_PATH=~/.config/solana/id.json pnpm --filter @hedged/solana relayer:set
```

The relayer also needs a little Devnet SOL for fees.

## Tests

```bash
pnpm --filter @hedged/solana test          # unit: PDAs vs Devnet, decoder on real logs, errors, HMAC, filter, verification
pnpm --filter @hedged/solana devnet:read   # read-only Devnet check: program, Config, recent txs
```

**Local end-to-end** (the deployed Devnet binary on a local validator, real relayer signatures):

```bash
solana program dump -u devnet E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr /tmp/escrow.so
solana-keygen new --no-bip39-passphrase -o /tmp/local-admin.json
solana-test-validator --reset --ledger /tmp/ledger --rpc-port 18899 \
  --upgradeable-program E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr /tmp/escrow.so "$(solana-keygen pubkey /tmp/local-admin.json)"
LOCALNET_RPC_URL=http://127.0.0.1:18899 LOCALNET_ADMIN_KEYPAIR=/tmp/local-admin.json \
  RELAYER_KEYPAIR_PATH=~/.config/solana/ubc-relayer.json pnpm --filter @hedged/solana test:localnet
```

It runs both promos end to end (YES refund, NO merchant payout, hedge-failure refund, customer
timeout cancel), every idempotency and race case of the gateway, live/replayed/deduped/redelivered
events, and the full Streams path (filter → signed webhook → verified events): 41 checks.
