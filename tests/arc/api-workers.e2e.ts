/**
 * Cross-module scenario: Rachel's REAL apps/api orchestrator + workers (in-memory store, stubbed
 * read-only Gemini quotes/outcome) driving the Arc escrow through @hedged/arc's ArcGateway on a
 * local anvil. Proves the gateway is a drop-in for the FakeSolanaGateway.
 *
 *   anvil --port 18545 --silent --slots-in-an-epoch 1 --block-time 1 &
 *   ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/api exec tsx ../../tests/arc/api-workers.e2e.ts
 *
 * Scenario: (1) deposit -> worker hedges on-chain -> HEDGED; (2) quote over the cap -> worker
 * cancels on-chain -> customer claims -> REFUNDED; (3) official YES -> worker resolves on-chain ->
 * customer claims -> CLAIMED. Gemini is stubbed: nothing here talks to Gemini.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarketOutcome, MarketQuote } from "../../packages/shared/src";
import { createOrchestrator } from "../../apps/api/src/orchestration/orchestrator";
import { startWorkers } from "../../apps/api/src/orchestration/workers";
import { MemoryStore } from "../../apps/api/src/store/memory-store";
import type { GeminiAdapter } from "../../apps/api/src/gemini/adapter";
import {
  HEDGED_ESCROW_ABI,
  HEDGED_ESCROW_BYTECODE,
  MOCK_USDC_ABI,
  MOCK_USDC_BYTECODE,
} from "../../packages/arc/src/abi";
import { newPurchaseIdHex, promoIdOf, purchaseKeyOf } from "../../packages/arc/src/ids";
import {
  buildApproveTx,
  buildClaimRefundTx,
  buildDepositTx,
  buildInitializePromoTx,
  type UnsignedTx,
} from "../../packages/arc/src/transactions";
import { createArcGatewayFromEnv } from "../../packages/arc/src/server";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "../../packages/arc/node_modules/viem";
import {
  generatePrivateKey,
  mnemonicToAccount,
  privateKeyToAccount,
  type HDAccount,
} from "../../packages/arc/node_modules/viem/accounts";

const RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:18545";
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const testClient = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const MN = "test test test test test test test test test test test junk";
const [admin, merchant, alice, bob] = [0, 2, 3, 4].map((i) =>
  mnemonicToAccount(MN, { addressIndex: i }),
) as HDAccount[] as [HDAccount, HDAccount, HDAccount, HDAccount];
const MARKET = "GEMI-SOL05M2611211505-UP";
const OFFER = 5_000_000n;

let passed = 0;
let failed = 0;
const check = (c: unknown, name: string, extra?: unknown) => {
  if (c) passed++;
  else failed++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${name}`, c ? "" : (extra ?? ""));
};
async function send(who: HDAccount, t: UnsignedTx) {
  const w = createWalletClient({ chain, transport: http(RPC), account: who });
  const hash = await w.sendTransaction({ to: t.to, data: t.data, value: 0n, account: who, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${t.description} reverted`);
}
async function deploy(
  abi: readonly unknown[],
  bytecode: Hex,
  args: readonly unknown[],
): Promise<Address> {
  const w = createWalletClient({ chain, transport: http(RPC), account: admin });
  const hash = await w.deployContract({
    abi: abi as never,
    bytecode,
    args: args as never,
    account: admin,
    chain,
  });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}
async function until(cond: () => Promise<boolean>, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const keyDir = mkdtempSync(join(tmpdir(), "arc-api-"));
  const keyPath = join(keyDir, "relayer.json");
  const relayerKey = generatePrivateKey();
  writeFileSync(keyPath, JSON.stringify({ privateKey: relayerKey }), { mode: 0o600 });
  const relayer = privateKeyToAccount(relayerKey);
  await testClient.setBalance({ address: relayer.address, value: 10n ** 20n });

  const usdc = await deploy(MOCK_USDC_ABI, MOCK_USDC_BYTECODE, []);
  const escrow = await deploy(HEDGED_ESCROW_ABI, HEDGED_ESCROW_BYTECODE, [
    usdc,
    relayer.address,
    600n,
  ]);
  const w = createWalletClient({ chain, transport: http(RPC), account: admin });
  for (const c of [alice, bob]) {
    await pub.waitForTransactionReceipt({
      hash: await w.writeContract({
        address: usdc,
        abi: MOCK_USDC_ABI,
        functionName: "mint",
        args: [c.address, 100n * OFFER],
        account: admin,
        chain,
      }),
    });
    await send(c, buildApproveTx(usdc, escrow, "max"));
  }

  // anvil's clock may run ahead of the wall clock (earlier increaseTime calls): follow the chain
  const chainNow = async () => Number((await pub.getBlock()).timestamp);
  let offset = (await chainNow()) - Math.floor(Date.now() / 1000);
  const nowUnix = () => Math.floor(Date.now() / 1000) + offset;

  const deadline = BigInt(nowUnix() + 25);
  await send(
    merchant,
    buildInitializePromoTx(escrow, {
      promoNonce: 1n,
      offerAmount: OFFER,
      depositDeadline: deadline,
      marketId: MARKET,
    }),
  );
  const promo = promoIdOf(merchant.address, 1n);

  // ---- THE ONE-LINE SWITCH (apps/api/src/index.ts): `await createArcGatewayFromEnv()` ----
  const gateway = await createArcGatewayFromEnv(
    {
      ARC_RPC_URL: RPC,
      ALLOW_LOCAL_CHAIN: "1",
      ARC_ESCROW_ADDRESS: escrow,
      ARC_RELAYER_KEY_PATH: keyPath,
      ARC_SWEEP_MS: "500",
    } as NodeJS.ProcessEnv,
    () => {},
  );

  const store = new MemoryStore();
  await store.createPromotion({
    promoPda: promo,
    promoNonce: "1",
    mint: usdc,
    itemName: "Latte",
    shopName: "Bean There",
    location: "Austin",
    merchant: merchant.address,
    offerAmount: OFFER,
    depositDeadline: Number(deadline),
    geminiMarketId: MARKET,
    outcomeLabel: "SOL up",
    maxYesPriceMicroUsd: 600_000n,
    hedgeBudget: 50_000_000n,
  });

  let askMicro = "500000";
  let outcome: MarketOutcome | null = null;
  const gemini: Pick<GeminiAdapter, "getQuote" | "getOutcome"> = {
    async getQuote(marketId) {
      const quote: MarketQuote = {
        source: "gemini-predictions",
        marketId,
        fetchedAt: new Date(nowUnix() * 1000).toISOString(),
        yesAskMicroUsd: askMicro,
        asks: [{ priceMicroUsd: askMicro, quantity: "2100" }],
      };
      return {
        quote,
        eventTicker: "SOL05M2611211505",
        eventTitle: "SOL",
        outcomeLabel: "Up",
        marketState: "open",
      };
    },
    async getOutcome() {
      return outcome;
    },
  };
  const silent = { info() {}, warn() {}, error() {} };
  const orchestrator = createOrchestrator({
    store,
    gateway,
    gemini,
    config: {
      maxQuoteAgeMs: 15_000,
      feeBps: 0,
      hedgeWindowFraction: 0.7,
      retry: { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 200 },
    },
    now: () => new Date(nowUnix() * 1000),
    log: silent,
  });
  const workers = await startWorkers({
    gateway,
    store,
    orchestrator,
    log: silent,
    resolvePollMs: 1000,
    reconcileMs: 60_000,
  });

  try {
    console.log("# 1. deposit -> hedged by the real worker on Arc (anvil)");
    const id1 = newPurchaseIdHex();
    await send(
      alice,
      buildDepositTx(escrow, { promoId: promo, purchaseIdHex: id1, amount: OFFER }),
    );
    const k1 = purchaseKeyOf(promo, alice.address, id1);
    const hedged = await until(async () => (await store.getPurchaseByPda(k1))?.status === "HEDGED");
    check(hedged, "store: HEDGED", (await store.getPurchaseByPda(k1))?.status);
    check(
      (await gateway.getPurchaseState(k1, "confirmed"))?.state === "Hedged",
      "chain: purchase is Hedged",
    );

    console.log("# 2. quote over the cap -> worker cancels on-chain -> customer refund");
    askMicro = "900000";
    const id2 = newPurchaseIdHex();
    await send(bob, buildDepositTx(escrow, { promoId: promo, purchaseIdHex: id2, amount: OFFER }));
    const k2 = purchaseKeyOf(promo, bob.address, id2);
    const cancelled = await until(
      async () => (await gateway.getPurchaseState(k2, "confirmed"))?.state === "Cancelled",
    );
    check(
      cancelled,
      "chain: over-cap purchase Cancelled by the relayer",
      (await gateway.getPurchaseState(k2, "confirmed"))?.state,
    );
    await until(async () =>
      ["CANCELLED", "REFUND_PENDING"].includes((await store.getPurchaseByPda(k2))?.status ?? ""),
    );
    await send(bob, buildClaimRefundTx(escrow, k2));
    const refunded = await until(
      async () => (await store.getPurchaseByPda(k2))?.status === "REFUNDED",
    );
    check(
      refunded,
      "store: REFUNDED after the verified claim",
      (await store.getPurchaseByPda(k2))?.status,
    );

    console.log(
      "# 3. official YES after the deadline -> worker resolves on-chain -> customer claims",
    );
    offset = (await chainNow()) - Math.floor(Date.now() / 1000);
    const wait = Number(deadline) - nowUnix() + 2;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait * 1000));
    outcome = {
      marketId: MARKET,
      outcome: "YES",
      source: "gemini-official-settlement",
      resolvedAt: new Date(nowUnix() * 1000).toISOString(),
      fetchedAt: new Date(nowUnix() * 1000).toISOString(),
    };
    const resolved = await until(
      async () => (await gateway.getPromoState(promo, "confirmed"))?.state === "ResolvedYes",
      40_000,
    );
    check(resolved, "chain: promo ResolvedYes (relayer-signed by the worker)");
    check(
      await until(async () => (await store.getPurchaseByPda(k1))?.status === "RESOLVED"),
      "store: RESOLVED",
      (await store.getPurchaseByPda(k1))?.status,
    );
    await send(alice, buildClaimRefundTx(escrow, k1));
    check(
      await until(async () => (await store.getPurchaseByPda(k1))?.status === "CLAIMED"),
      "store: CLAIMED after the verified YES refund",
      (await store.getPurchaseByPda(k1))?.status,
    );
    const p = await gateway.getPromoState(promo, "confirmed");
    check(
      p?.outstanding === "0" && p.vaultBalance === "0",
      "escrow fully settled (outstanding 0, vault 0)",
    );
  } finally {
    await workers.stop();
    await gateway.stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
