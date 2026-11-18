import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config";
import type { GeminiAdapter } from "./gemini/adapter";
import { withGeminiCache } from "./gemini/cached";
import { createDesk } from "./desk/run";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";

test("gemini cache: concurrent calls share one request; refetch after TTL; errors not cached", async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const inner = {
    getQuote: async (id: string) => {
      calls++;
      if (fail) throw new Error("429");
      return { quote: { marketId: id, fetchedAt: "t", yesAskMicroUsd: "1", asks: [] } };
    },
  } as unknown as GeminiAdapter;
  const g = withGeminiCache(inner, { quoteMs: 2000 } as never, () => clock);

  await Promise.all([g.getQuote("A"), g.getQuote("A"), g.getQuote("A")]);
  assert.equal(calls, 1);
  clock = 1999;
  await g.getQuote("A");
  assert.equal(calls, 1);
  clock = 2000;
  await g.getQuote("A");
  assert.equal(calls, 2);

  fail = true;
  clock = 5000;
  await assert.rejects(g.getQuote("B"));
  fail = false;
  await g.getQuote("B");
  assert.equal(calls, 4, "a failed request is retried, not served from cache");
});

test("write rate limit: POSTs over the limit get 429; GETs and webhooks are not limited", async () => {
  const app = await buildServer(loadConfig({ WRITE_RATE_LIMIT_PER_MIN: "2" }), {
    store: new MemoryStore(),
    gateway: null,
  });
  app.log.level = "silent";
  const post = () => app.inject({ method: "POST", url: "/api/promotions", payload: {} });
  assert.equal((await post()).statusCode, 400);
  assert.equal((await post()).statusCode, 400);
  const limited = await post();
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
  const hook = await app.inject({ method: "POST", url: "/webhooks/quicknode", payload: "{}" });
  assert.equal(hook.statusCode, 503, "webhook is not rate-limited (disabled here, so 503)");
  await app.close();
});

test("line picker rejects malformed event tickers with 400 (not 500)", async () => {
  const app = await buildServer(loadConfig({}), { store: new MemoryStore(), gateway: null });
  app.log.level = "silent";
  const res = await app.inject({ url: "/api/events/bad%20ticker!/lines" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_event_ticker");
  await app.close();
});

test("desk: does not trade an event whose type (moneyline or not) is unknown", async () => {
  const store = new MemoryStore();
  const promo = await store.createPromotion({
    promoPda: "PROMO",
    promoNonce: "1",
    mint: "M",
    merchant: "MER",
    itemName: "Latte",
    shopName: "S",
    location: "",
    offerAmount: 5_000_000n,
    depositDeadline: 2_000_000_000,
    geminiMarketId: "GEMI-EVT-TEX",
    outcomeLabel: "x",
    maxYesPriceMicroUsd: 1_000_000n,
    hedgeBudget: 10_000_000_000n,
  });
  const { purchase } = await store.recordDeposit(
    {
      signature: "S",
      eventIndex: 0,
      slot: 1,
      blockTime: null,
      commitment: "finalized",
      promo: "PROMO",
      purchase: "P",
      customer: "C",
      purchaseId: "a".repeat(32),
      amount: "5000000",
      depositedAt: 0,
    },
    promo.id,
  );
  await store.reserveHedge({
    purchaseId: purchase.id,
    promotionId: promo.id,
    marketId: "GEMI-EVT-TEX",
    quoteId: null,
    status: "SIMULATED_FILLED",
    failureReason: null,
    requestedContracts: "5",
    filledContracts: "5",
    avgFillPriceMicroUsd: "500000",
    premium: 2_500_000n,
    modeledFee: 0n,
    assumptions: [],
    quoteFetchedAt: new Date().toISOString(),
  });
  let bookCalls = 0;
  const desk = createDesk({
    store,
    lotContracts: 10,
    gemini: {
      getEventInfo: async () => {
        throw new Error("gemini down");
      },
      getBook: async () => {
        bookCalls++;
        return { asks: [], bids: [], fetchedAt: "" };
      },
    },
  });
  const r = await desk.rebalance();
  assert.equal(r.orders, 0);
  assert.equal(bookCalls, 0);
  assert.match(r.skipped[0] ?? "", /event info unavailable/);
});
