import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOutcome } from "@hedged/shared";
import { loadConfig } from "../config";
import type { GeminiAdapter } from "../gemini/adapter";
import { hedgeFingerprint } from "../hedging/fingerprint";
import { FakeSolanaGateway } from "../orchestration/fake-gateway";
import { createOrchestrator } from "../orchestration/orchestrator";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";

const PROMO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const P_OK = "4Nd1mYhYbJ9Pq5ZbpgqVHyBnq8ENjZ1hyUrsMg2GJmQ5";
const P_CAP = "3Jg1jWBKbzRuqyqMtkWXr8uLKGxsq7dBtRuzLKH6KmFb";
const MARKET = "GEMI-SOL05M2611211505-UP";

test("fingerprint is deterministic and changes with any hedge field", () => {
  const h = {
    marketId: MARKET,
    requestedContracts: "5",
    filledContracts: "5",
    avgFillPriceMicroUsd: "500000",
    premium: 2_500_000n,
    quoteFetchedAt: "2026-11-21T14:50:00.000Z",
  };
  const a = hedgeFingerprint(P_OK, h);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(hedgeFingerprint(P_OK, { ...h }), a);
  assert.notEqual(hedgeFingerprint(P_OK, { ...h, premium: 2_500_001n }), a);
  assert.notEqual(hedgeFingerprint(P_CAP, h), a);
});

test("receipt: hedged purchase can be served; failed one shows refund; result shows win", async () => {
  let ask = "500000";
  let outcome: MarketOutcome | null = null;
  const nowUnix = () => Math.floor(Date.now() / 1000);
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(nowUnix);
  const deadline = nowUnix() + 600;
  gateway.addPromo({ promoPda: PROMO, marketId: MARKET, depositDeadline: deadline });
  const promo = await store.createPromotion({
    promoPda: PROMO,
    promoNonce: "1",
    mint: "MINT",
    merchant: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    itemName: "Latte",
    shopName: "Bean There",
    location: "Austin",
    offerAmount: 5_000_000n,
    depositDeadline: deadline,
    geminiMarketId: MARKET,
    outcomeLabel: "SOL up at 9:05",
    maxYesPriceMicroUsd: 600_000n,
    hedgeBudget: 100_000_000n,
  });
  const gemini = {
    getQuote: async (marketId: string) => ({
      quote: {
        source: "gemini-predictions" as const,
        marketId,
        fetchedAt: new Date().toISOString(),
        yesAskMicroUsd: ask,
        asks: [{ priceMicroUsd: ask, quantity: "1000" }],
      },
      eventTicker: "SOL05M2611211505",
      eventTitle: "SOL",
      outcomeLabel: "Up",
      marketState: "open",
    }),
    getOutcome: async () => outcome,
  } as unknown as GeminiAdapter;
  const orch = createOrchestrator({
    store,
    gateway,
    gemini,
    config: {
      maxQuoteAgeMs: 15_000,
      feeBps: 0,
      hedgeWindowFraction: 0.7,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    },
    sleep: async () => {},
  });
  const app = await buildServer(loadConfig({}), { gemini, store, gateway });
  app.log.level = "silent";
  const receipt = async (pda: string) =>
    (await app.inject({ url: `/api/purchases/${pda}` })).json();

  await orch.handleDeposit(gateway.deposit(PROMO, P_OK));
  const ok = await receipt(P_OK);
  assert.equal(ok.step, "HEDGED");
  assert.equal(ok.canServe, true);
  assert.equal(ok.onChainState, "Hedged");
  assert.equal(ok.hedge.simulated, true);
  assert.equal(ok.hedge.premium, "2500000");
  assert.match(ok.hedge.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(ok.promotion.shopName, "Bean There");

  ask = "900000"; // over the 60% threshold
  await orch.handleDeposit(gateway.deposit(PROMO, P_CAP));
  const capped = await receipt(P_CAP);
  assert.equal(capped.step, "REFUND_READY");
  assert.equal(capped.canServe, false);

  gateway.promos.get(PROMO)!.depositDeadline = nowUnix() - 1; // deadline passed on-chain
  outcome = {
    marketId: MARKET,
    outcome: "YES",
    source: "gemini-official-settlement",
    resolvedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };
  const row = (await store.getPromotion(promo.id))!;
  await orch.resolveIfFinal({ ...row, depositDeadline: nowUnix() - 1 });
  const won = await receipt(P_OK);
  assert.equal(won.step, "YOU_WON");
  assert.equal(won.hedge.status, "SETTLED_WIN");
  assert.equal(won.hedge.virtualPayout, "5000000");

  assert.equal((await app.inject({ url: "/api/purchases/nope" })).statusCode, 400);
  assert.equal(
    (await app.inject({ url: "/api/purchases/5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1" }))
      .statusCode,
    404,
  );
  await app.close();
});
