/**
 * End-to-end test of @hedged/solana against a LOCAL validator running the deployed Devnet escrow
 * binary. Exercises every browser-safe builder and every SolanaServerGateway method with a real
 * relayer signature, plus the verified event pipeline (live, replay, dedupe, redelivery).
 *
 * Setup (see packages/solana/README.md "Local end-to-end test"):
 *   solana program dump -u devnet E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr /tmp/escrow.so
 *   solana-keygen new --no-bip39-passphrase -o /tmp/local-admin.json
 *   solana-test-validator --reset --quiet --ledger /tmp/ledger \
 *     --upgradeable-program E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr /tmp/escrow.so \
 *     "$(solana-keygen pubkey /tmp/local-admin.json)"
 *   LOCALNET_ADMIN_KEYPAIR=/tmp/local-admin.json RELAYER_KEYPAIR_PATH=~/.config/solana/ubc-relayer.json \
 *     pnpm --filter @hedged/solana test:localnet
 */
import { SolanaGatewayError, chainEventId, type ProgramEvent } from "@hedged/shared";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { randomBytes } from "node:crypto";
import { utils } from "@coral-xyz/anchor";
import {
  ESCROW_PROGRAM_ID,
  buildCancelExpiredDepositTransaction,
  buildClaimMerchantTransaction,
  buildClaimRefundTransaction,
  buildDepositTransaction,
  buildInitializePromoTransaction,
  canTimeoutCancel,
  createEscrowProgram,
  deriveConfigPda,
  deriveTokenAccount,
  getClusterTime,
} from "../src/index";
import {
  GatewayInvalidStateError,
  RealSolanaGateway,
  ResolutionTooEarlyError,
  computeStreamsSignature,
  loadRelayerKeypair,
  runStreamsFilterLocally,
  startStreamsWebhookServer,
} from "../src/server/index";

const RPC = process.env.LOCALNET_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC, "confirmed");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`, detail ?? "");
  }
}
async function expectGatewayError(
  name: string,
  p: Promise<unknown>,
  pred: (e: SolanaGatewayError) => boolean,
) {
  try {
    await p;
    check(name, false, "did not throw");
  } catch (e) {
    check(name, e instanceof SolanaGatewayError && pred(e), e);
  }
}

async function sendAs(tx: Transaction, signer: Keypair): Promise<string> {
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  return sig;
}
async function airdrop(pk: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}
async function waitUntilCluster(t: number) {
  while ((await getClusterTime(connection)) < t) await sleep(500);
}

const genesis = await connection.getGenesisHash();
if (genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("mainnet!");
const admin = loadRelayerKeypair(process.env.LOCALNET_ADMIN_KEYPAIR ?? "");
const relayer = loadRelayerKeypair(process.env.RELAYER_KEYPAIR_PATH ?? "");
const merchant = Keypair.generate();
const customer = Keypair.generate();
const stranger = Keypair.generate();
console.log("relayer", relayer.publicKey.toBase58());

for (const k of [
  admin.publicKey,
  relayer.publicKey,
  merchant.publicKey,
  customer.publicKey,
  stranger.publicKey,
]) {
  await airdrop(k);
}
const startSlot = await connection.getSlot("confirmed");

// ---- config: mock mint (6 decimals, no freeze authority) + initialize_config -------------------
console.log("\n[setup] mint + config");
const mint = await createMint(connection, admin, admin.publicKey, null, 6);
const custAta = await getOrCreateAssociatedTokenAccount(
  connection,
  admin,
  mint,
  customer.publicKey,
);
await getOrCreateAssociatedTokenAccount(connection, admin, mint, merchant.publicKey);
await mintTo(connection, admin, mint, custAta.address, admin, 100_000_000);
const program = createEscrowProgram(connection);
const [programData] = PublicKey.findProgramAddressSync(
  [ESCROW_PROGRAM_ID.toBuffer()],
  BPF_UPGRADEABLE,
);
const CANCEL_TIMEOUT = 4;
const initIx = await program.methods
  .initializeConfig(relayer.publicKey, new BN(CANCEL_TIMEOUT))
  .accountsStrict({
    admin: admin.publicKey,
    program: ESCROW_PROGRAM_ID,
    programData,
    config: new PublicKey(deriveConfigPda(ESCROW_PROGRAM_ID.toBase58()).address),
    mint,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
{
  const { Transaction } = await import("@solana/web3.js");
  const bh = await connection.getLatestBlockhash();
  await sendAs(new Transaction({ feePayer: admin.publicKey, ...bh }).add(initIx), admin);
}

const logs: string[] = [];
const gateway = new RealSolanaGateway({
  connection,
  relayer,
  commitment: "confirmed",
  sweepMs: 1500,
  timeoutMs: 60_000,
  log: (m, x) => logs.push(`${m} ${JSON.stringify(x ?? {})}`),
});
const strangerGateway = new RealSolanaGateway({
  connection,
  relayer: stranger,
  commitment: "confirmed",
});

const cfg = await gateway.getConfig();
check(
  "getConfig decodes relayer/mint/timeout",
  cfg?.relayer === relayer.publicKey.toBase58() &&
    cfg?.mint === mint.toBase58() &&
    cfg?.cancelTimeoutSecs === CANCEL_TIMEOUT,
  cfg,
);

// ---- live subscriptions (one handler throws once to prove redelivery) ------------------------
const got: { deposits: object[]; resolutions: object[]; claims: object[] } = {
  deposits: [],
  resolutions: [],
  claims: [],
};
let threwOnce = false;
const subs = [
  await gateway.subscribeToDeposits(async (e) => {
    if (!threwOnce) {
      threwOnce = true;
      throw new Error("simulated handler failure");
    }
    (got.deposits as object[]).push(e);
  }),
  await gateway.subscribeToResolutions(async (e) => void (got.resolutions as object[]).push(e)),
  await gateway.subscribeToClaims(async (e) => void (got.claims as object[]).push(e)),
];

// ---- promo A: YES path + hedge-failure refund path ------------------------------------------
console.log("\n[promo A] YES path, cancel path, idempotency");
const now = await getClusterTime(connection);
const deadlineA = now + 25;
const pA = await buildInitializePromoTransaction({
  connection,
  merchant: merchant.publicKey.toBase58(),
  depositDeadline: deadlineA,
  marketId: "GEMI-TEST-YES",
});
await sendAs(pA.transaction, merchant);
const promoA = await gateway.getPromoState(pA.promoPda);
check(
  "initialize_promo builder: promo Active, vault + timeout snapshot",
  promoA?.state === "Active" &&
    promoA.vault === pA.vault &&
    promoA.cancelTimeoutSecs === CANCEL_TIMEOUT,
  promoA,
);

const d1 = await buildDepositTransaction({
  connection,
  customer: customer.publicKey.toBase58(),
  promoPda: pA.promoPda,
});
const d1Sig = await sendAs(d1.transaction, customer);
const d2 = await buildDepositTransaction({
  connection,
  customer: customer.publicKey.toBase58(),
  promoPda: pA.promoPda,
});
await sendAs(d2.transaction, customer);
const pur1 = await gateway.getPurchaseState(d1.purchasePda);
check(
  "deposit builder: purchase Deposited, 5 tokens, id round-trips",
  pur1?.state === "Deposited" && pur1.amount === "5000000" && pur1.purchaseId === d1.purchaseId,
  pur1,
);

const v = await gateway.verifyTransaction(d1Sig);
check(
  "verifyTransaction: confirmed + one verified DepositEvent",
  v.confirmed &&
    v.events.length === 1 &&
    v.events[0]?.name === "DepositEvent" &&
    v.events[0].eventIndex === 0,
  v,
);

await expectGatewayError(
  "markHedged by a non-relayer key → NOT_AUTHORIZED",
  strangerGateway.markHedged(d1.purchasePda),
  (e) => e.code === "NOT_AUTHORIZED",
);

const r1 = await gateway.markHedged(d1.purchasePda);
check(
  "markHedged: receipt, alreadyApplied=false, signature",
  !r1.alreadyApplied && typeof r1.signature === "string",
  r1,
);
const r1b = await gateway.markHedged(d1.purchasePda);
check(
  "markHedged repeat: alreadyApplied=true, original signature found",
  r1b.alreadyApplied && r1b.signature === r1.signature,
  r1b,
);
await expectGatewayError(
  "cancelUnhedged on a Hedged purchase → INVALID_STATE (observed Hedged)",
  gateway.cancelUnhedged(d1.purchasePda),
  (e) => e.code === "INVALID_STATE" && (e as GatewayInvalidStateError).observedState === "Hedged",
);

const c2 = await gateway.cancelUnhedged(d2.purchasePda, { commitment: "finalized" });
check(
  "cancelUnhedged at finalized: receipt",
  !c2.alreadyApplied && c2.commitment === "finalized",
  c2,
);
const c2b = await gateway.cancelUnhedged(d2.purchasePda);
check("cancelUnhedged repeat: alreadyApplied", c2b.alreadyApplied, c2b);
await expectGatewayError(
  "markHedged on a Cancelled purchase → INVALID_STATE (observed Cancelled)",
  gateway.markHedged(d2.purchasePda),
  (e) =>
    e.code === "INVALID_STATE" && (e as GatewayInvalidStateError).observedState === "Cancelled",
);

const refund2 = await buildClaimRefundTransaction({ connection, purchasePda: d2.purchasePda });
await sendAs(refund2.transaction, customer);
check(
  "claim_refund builder (cancel path): Refunded",
  (await gateway.getPurchaseState(d2.purchasePda))?.state === "Refunded",
);

await expectGatewayError(
  "resolvePromotion before deadline → ResolutionTooEarly, retryable",
  gateway.resolvePromotion(pA.promoPda, "YES"),
  (e) => e instanceof ResolutionTooEarlyError && e.retryable && e.retryAfterUnix === deadlineA,
);

// ---- promo B: NO path + customer timeout cancel ------------------------------------------------
console.log("\n[promo B] NO path, customer timeout cancel");
const pB = await buildInitializePromoTransaction({
  connection,
  merchant: merchant.publicKey.toBase58(),
  depositDeadline: (await getClusterTime(connection)) + 25,
  marketId: "GEMI-TEST-NO",
});
await sendAs(pB.transaction, merchant);
const d3 = await buildDepositTransaction({
  connection,
  customer: customer.publicKey.toBase58(),
  promoPda: pB.promoPda,
});
await sendAs(d3.transaction, customer);
const d4 = await buildDepositTransaction({
  connection,
  customer: customer.publicKey.toBase58(),
  promoPda: pB.promoPda,
});
await sendAs(d4.transaction, customer);
await gateway.markHedged(d3.purchasePda);

const pur4 = (await gateway.getPurchaseState(d4.purchasePda))!;
const promoB = (await gateway.getPromoState(pB.promoPda))!;
check(
  "canTimeoutCancel false right after deposit",
  !canTimeoutCancel(pur4, promoB, await getClusterTime(connection)),
);
await waitUntilCluster(pur4.depositedAt + CANCEL_TIMEOUT);
check(
  "canTimeoutCancel true after the timeout (cluster time)",
  canTimeoutCancel(pur4, promoB, await getClusterTime(connection)),
);
const ce = await buildCancelExpiredDepositTransaction({ connection, purchasePda: d4.purchasePda });
await sendAs(ce.transaction, customer);
check(
  "cancel_expired_deposit builder: Cancelled",
  (await gateway.getPurchaseState(d4.purchasePda))?.state === "Cancelled",
);
await expectGatewayError(
  "markHedged after customer timeout-cancel → INVALID_STATE (race loser)",
  gateway.markHedged(d4.purchasePda),
  (e) => e.code === "INVALID_STATE",
);
const ce2 = await gateway.cancelUnhedged(d4.purchasePda);
check(
  "cancelUnhedged after customer cancel → alreadyApplied (same target)",
  ce2.alreadyApplied,
  ce2,
);
await sendAs(
  (await buildClaimRefundTransaction({ connection, purchasePda: d4.purchasePda })).transaction,
  customer,
);

// ---- resolution + claims ------------------------------------------------------------------
console.log("\n[resolve] after deadlines");
await waitUntilCluster(Math.max(deadlineA, promoB.depositDeadline));
const resA = await gateway.resolvePromotion(pA.promoPda, "YES");
check("resolvePromotion YES: receipt", !resA.alreadyApplied && !!resA.signature, resA);
const resA2 = await gateway.resolvePromotion(pA.promoPda, "YES");
check("resolvePromotion YES again: alreadyApplied", resA2.alreadyApplied, resA2);
await expectGatewayError(
  "resolvePromotion NO on a YES promo → INVALID_STATE (conflict)",
  gateway.resolvePromotion(pA.promoPda, "NO"),
  (e) => e.code === "INVALID_STATE",
);
await expectGatewayError(
  "cancelUnhedged on a hedged purchase after resolution → INVALID_STATE",
  gateway.cancelUnhedged(d1.purchasePda),
  (e) => e.code === "INVALID_STATE",
);
const resB = await gateway.resolvePromotion(pB.promoPda, "NO");
check("resolvePromotion NO: receipt", !resB.alreadyApplied, resB);

const before = (await getAccount(connection, custAta.address)).amount;
await sendAs(
  (await buildClaimRefundTransaction({ connection, purchasePda: d1.purchasePda })).transaction,
  customer,
);
const after = (await getAccount(connection, custAta.address)).amount;
check(
  "claim_refund builder (YES path): ClaimedByCustomer, +5 tokens",
  (await gateway.getPurchaseState(d1.purchasePda))?.state === "ClaimedByCustomer" &&
    after - before === 5_000_000n,
);
await sendAs(
  (await buildClaimMerchantTransaction({ connection, purchasePda: d3.purchasePda })).transaction,
  merchant,
);
const merchantBal = (
  await getAccount(
    connection,
    new PublicKey(
      deriveTokenAccount({ owner: merchant.publicKey.toBase58(), mint: mint.toBase58() }),
    ),
  )
).amount;
check(
  "claim_merchant builder (NO path): ClaimedByMerchant, merchant +5",
  (await gateway.getPurchaseState(d3.purchasePda))?.state === "ClaimedByMerchant" &&
    merchantBal === 5_000_000n,
);

const list = await gateway.listPurchases(pA.promoPda);
check(
  "listPurchases(promo A) returns its 2 purchases only",
  list.length === 2 && list.every((p) => p.promoPda === pA.promoPda),
  list.map((p) => p.state),
);
const finalA = (await gateway.getPromoState(pA.promoPda))!;
check(
  "promo A accounting: outstanding 0, vault 0",
  finalA.outstanding === "0" && finalA.vaultBalance === "0" && finalA.totalPaidOut === "10000000",
  finalA,
);

// ---- event pipeline ---------------------------------------------------------------------------
console.log("\n[events] live delivery, redelivery, dedupe, replay");
const deadline = Date.now() + 30_000;
while (
  Date.now() < deadline &&
  ((got.deposits as object[]).length < 4 ||
    (got.resolutions as object[]).length < 2 ||
    (got.claims as object[]).length < 4)
) {
  await sleep(500);
}
const ids = (arr: object[]) => arr.map((e) => chainEventId(e as ProgramEvent));
check(
  "live: 4 DepositEvents (after one handler failure + redelivery)",
  (got.deposits as object[]).length === 4 && threwOnce,
  got.deposits.length,
);
check(
  "live: 2 ResolutionEvents with outcomes YES/NO",
  (got.resolutions as { outcome: string }[])
    .map((r) => r.outcome)
    .sort()
    .join() === "NO,YES",
  got.resolutions,
);
check(
  "live: 4 ClaimEvents (2 CANCEL_REFUND, 1 YES_REFUND, 1 MERCHANT_PAYOUT)",
  (got.claims as { kind: string }[])
    .map((c) => c.kind)
    .sort()
    .join() === "CANCEL_REFUND,CANCEL_REFUND,MERCHANT_PAYOUT,YES_REFUND",
  got.claims,
);
check(
  "live: no duplicate chainEventIds",
  new Set([...ids(got.deposits as object[]), ...ids(got.claims as object[])]).size === 8,
);
check(
  "delivered events carry no internal `name` tag",
  !("name" in ((got.deposits as object[])[0] ?? {})),
);

// Duplicate signals (as if QuickNode Streams + WebSocket + sweep all reported the same tx).
const sigs = (got.claims as { signature: string }[]).map((c) => ({ signature: c.signature }));
gateway.ingestStreams(sigs);
gateway.ingestStreams(sigs);
await gateway.sweepNow();
await sleep(2000);
check(
  "duplicate Streams/WS/sweep signals deliver nothing new",
  (got.claims as object[]).length === 4,
);

// Replay from a checkpoint with a fresh gateway (restart).
const replayGw = new RealSolanaGateway({
  connection,
  relayer,
  commitment: "confirmed",
  sweepMs: 0,
});
const replayed: object[] = [];
const rs = await replayGw.subscribeToDeposits(async (e) => void replayed.push(e), {
  fromSlot: startSlot,
});
await sleep(1500);
check(
  "replay fromSlot: all 4 deposits redelivered after restart",
  replayed.length === 4,
  replayed.length,
);
check(
  "replay ids match live ids",
  ids(replayed).sort().join() ===
    ids(got.deposits as object[])
      .sort()
      .join(),
);
await rs.stop();

// ---- QuickNode Streams path ----------------------------------------------------------------
console.log("\n[streams] filter -> signed webhook -> verified events (QuickNode Streams mode)");
const streamsGw = new RealSolanaGateway({
  connection,
  relayer,
  commitment: "confirmed",
  eventSource: "streams",
  sweepMs: 0,
});
const viaStreams: object[] = [];
const ss = await streamsGw.subscribeToClaims(async (e) => void viaStreams.push(e));
const token = randomBytes(32).toString("hex");
const PORT = 18950;
const server = await startStreamsWebhookServer({
  port: PORT,
  securityToken: token,
  onSignals: (sg) => streamsGw.ingestStreams(sg),
});

// Rebuild what Streams' `programs_with_logs` dataset delivers for these txs (+ a decoy transfer).
async function asProgramsWithLogs(signature: string) {
  const tx = (await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  }))!;
  const keys = tx.transaction.message.getAccountKeys();
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    programInvocations: tx.transaction.message.compiledInstructions.map((ix, index) => ({
      programId: keys.get(ix.programIdIndex)!.toBase58(),
      instruction: { index, accounts: [], data: utils.bytes.bs58.encode(Buffer.from(ix.data)) },
    })),
    logs: tx.meta?.logMessages ?? [],
    success: !tx.meta?.err,
  };
}
const decoySig = await connection.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL);
await connection.confirmTransaction(
  { signature: decoySig, ...(await connection.getLatestBlockhash()) },
  "confirmed",
);
const claimSigs = (got.claims as { signature: string }[]).map((c) => c.signature);
const batch = await Promise.all([...claimSigs, decoySig].map(asProgramsWithLogs));
const filtered = runStreamsFilterLocally({
  data: [batch],
  metadata: { network: "solana-devnet", dataset: "programs_with_logs" },
}) as {
  matchedTransactions: { signature: string; instructions: string[]; events: { name: string }[] }[];
};
check(
  "filter keeps the 4 escrow txs, drops the decoy",
  filtered.matchedTransactions.length === 4 &&
    !filtered.matchedTransactions.some((t) => t.signature === decoySig),
  filtered.matchedTransactions.length,
);
check(
  "filter labels instructions + events from discriminators",
  filtered.matchedTransactions.every(
    (t) =>
      t.events.length === 1 &&
      t.events[0]!.name === "ClaimEvent" &&
      ["claim_refund", "claim_merchant"].includes(t.instructions[0]!),
  ),
  filtered.matchedTransactions,
);
check(
  "filter returns null for a batch with no escrow txs",
  runStreamsFilterLocally({ data: [[await asProgramsWithLogs(decoySig)]] }) === null,
);

const body = JSON.stringify(filtered);
const nonce = randomBytes(8).toString("hex");
const ts = String(Math.floor(Date.now() / 1000));
const post = (headers: Record<string, string>) =>
  fetch(`http://127.0.0.1:${PORT}/webhooks/quicknode`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
const bad = await post({
  "x-qn-nonce": nonce,
  "x-qn-timestamp": ts,
  "x-qn-signature": "00".repeat(32),
});
check("webhook rejects a bad HMAC (401)", bad.status === 401);
const good = await post({
  "x-qn-nonce": nonce,
  "x-qn-timestamp": ts,
  "x-qn-signature": computeStreamsSignature(token, nonce, ts, body),
});
check("webhook accepts a valid HMAC (200)", good.status === 200, await good.text());
const until = Date.now() + 20_000;
while (Date.now() < until && viaStreams.length < 4) await sleep(300);
check(
  "Streams-mode gateway delivers the 4 verified ClaimEvents",
  viaStreams.length === 4 && streamsGw.eventStats.viaStreams === 4,
  { n: viaStreams.length, stats: streamsGw.eventStats },
);
await new Promise((r) => server.close(r));
await ss.stop();
await streamsGw.stop();

for (const s of subs) await s.stop();
await gateway.stop();
await strangerGateway.stop();
await replayGw.stop();
console.log(`\nstats ${JSON.stringify(gateway.eventStats)}`);
if (logs.some((l) => l.startsWith("VERIFICATION_FAILED")))
  console.log(
    "verification log:",
    logs.filter((l) => l.startsWith("VERIFICATION")),
  );
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
