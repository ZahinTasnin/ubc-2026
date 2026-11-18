import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOutcome, MarketQuote } from "@hedged/shared";
import type { GeminiAdapter } from "../gemini/adapter";
import { MemoryStore } from "../store/memory-store";
import { FakeSolanaGateway } from "./fake-gateway";
import { createOrchestrator } from "./orchestrator";
import { startWorkers } from "./workers";

const MARKET = "GEMI-SOL05M2611211505-UP";

test("workers: subscribed deposit is hedged and acked; timer resolves on the official outcome", async () => {
  let clock = Date.parse("2026-11-21T14:50:00Z");
  const nowUnix = () => Math.floor(clock / 1000);
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(nowUnix);
  const deadline = Math.floor(Date.parse("2026-11-21T14:55:00Z") / 1000);
  gateway.addPromo({ promoPda: "PROMO", marketId: MARKET, depositDeadline: deadline });
  await store.createPromotion({
    promoPda: "PROMO",
    promoNonce: "1",
    mint: "FAKE_MINT",
    itemName: "Latte",
    shopName: "Bean There",
    location: "Austin",
    merchant: "FAKE_MERCHANT",
    offerAmount: 5_000_000n,
    depositDeadline: deadline,
    geminiMarketId: MARKET,
    outcomeLabel: "SOL up",
    maxYesPriceMicroUsd: 600_000n,
    hedgeBudget: 50_000_000n,
  });

  let outcome: MarketOutcome | null = null;
  const gemini: Pick<GeminiAdapter, "getQuote" | "getOutcome"> = {
    async getQuote(marketId) {
      const quote: MarketQuote = {
        source: "gemini-predictions",
        marketId,
        fetchedAt: new Date(clock).toISOString(),
        yesAskMicroUsd: "500000",
        asks: [{ priceMicroUsd: "500000", quantity: "2100" }],
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
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    },
    now: () => new Date(clock),
    sleep: async () => {},
    log: silent,
  });
  const workers = await startWorkers({
    gateway,
    store,
    orchestrator,
    log: silent,
    resolvePollMs: 60_000,
    reconcileMs: 60_000,
  });

  try {
    const ev = gateway.deposit("PROMO", "P1");
    await gateway.emitDeposit(ev);
    assert.equal((await store.getPurchaseByPda("P1"))?.status, "HEDGED");
    assert.equal(await store.getCheckpoint("deposits"), ev.slot);

    // Window ends at 15:05; Gemini posts the official result a few seconds later.
    clock = Date.parse("2026-11-21T15:05:03Z");
    await workers.tick();
    assert.equal(gateway.promos.get("PROMO")?.state, "Active");

    outcome = {
      marketId: MARKET,
      outcome: "YES",
      source: "gemini-official-settlement",
      resolvedAt: "2026-11-21T15:05:05.000Z",
      fetchedAt: "2026-11-21T15:05:06.000Z",
    };
    clock = Date.parse("2026-11-21T15:05:06Z");
    await workers.tick();
    assert.equal(gateway.promos.get("PROMO")?.state, "ResolvedYes");
    assert.equal((await store.getPurchaseByPda("P1"))?.status, "RESOLVED");

    const claim = gateway.claim("P1");
    await gateway.emitClaim(claim);
    assert.equal((await store.getPurchaseByPda("P1"))?.status, "CLAIMED");
    assert.equal(await store.getCheckpoint("claims"), claim.slot);
  } finally {
    await workers.stop();
  }
});
