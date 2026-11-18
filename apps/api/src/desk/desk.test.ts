import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOutcome, QuoteLevel } from "@hedged/shared";
import { loadConfig } from "../config";
import type { GeminiAdapter } from "../gemini/adapter";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";
import { computeEventDesk, planOrders, walkBook } from "./desk";
import { createDesk } from "./run";

const TEX = "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX";
const ARK = "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK";
const EVENT = "NCAAF-2611212030-ARK-TEX-M";
const contracts = [
  { marketId: ARK, label: "Arkansas" },
  { marketId: TEX, label: "Texas" },
];
const $ = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const H = (contracts: number) => BigInt(Math.round(contracts * 100));

test("moneyline: opposite promos net out; only the residual is hedged", () => {
  // Shop A: 100 lattes "free if Texas wins" (500 contracts @ 0.92 = $460 premium).
  // Shop B: 60 lattes "free if Arkansas wins" (300 contracts @ 0.09 = $27 premium).
  const exposures = [
    { marketId: TEX, contractsH: H(500), premium: $(460) },
    { marketId: ARK, contractsH: H(300), premium: $(27) },
  ];
  const before = computeEventDesk({ exclusive: true, contracts, exposures, fills: [] });
  assert.equal(before.certainLiabilityH, H(300), "300 contracts are owed whoever wins");
  const tex = before.lines.find((l) => l.marketId === TEX)!;
  const ark = before.lines.find((l) => l.marketId === ARK)!;
  assert.equal(tex.targetH, H(200));
  assert.equal(ark.targetH, 0n);
  assert.equal(before.covered, false, "not covered until the residual is bought");

  // Desk buys the 200 residual Texas contracts at 0.92 = $184 (vs $487 hedging every sale).
  const after = computeEventDesk({
    exclusive: true,
    contracts,
    exposures,
    fills: [{ marketId: TEX, side: "BUY", contractsH: H(200), amount: $(184) }],
  });
  assert.equal(after.deskCost, $(184));
  assert.equal(after.savings, $(303));
  assert.deepEqual(
    after.pnlIfWins?.map((o) => [o.marketId, o.pnl]),
    [
      [ARK, $(3)], // cash 303 + 0 - 300
      [TEX, $(3)], // cash 303 + 200 - 500
    ],
  );
  assert.equal(after.covered, true);
});

test("no netting when premiums cannot pay the certain part, or for non-exclusive lines", () => {
  const exposures = [
    { marketId: TEX, contractsH: H(500), premium: $(10) },
    { marketId: ARK, contractsH: H(300), premium: $(10) },
  ];
  const broke = computeEventDesk({ exclusive: true, contracts, exposures, fills: [] });
  assert.equal(broke.certainLiabilityH, 0n);
  assert.equal(broke.lines.find((l) => l.marketId === TEX)!.targetH, H(500));

  const spreads = computeEventDesk({ exclusive: false, contracts, exposures, fills: [] });
  assert.equal(spreads.certainLiabilityH, 0n);
  assert.equal(spreads.pnlIfWins, null);
  assert.deepEqual(
    spreads.lines.map((l) => l.targetH),
    [H(300), H(500)],
  );
});

test("one-sided exposure: nothing nets (the other side owes nothing)", () => {
  const d = computeEventDesk({
    exclusive: true,
    contracts,
    exposures: [{ marketId: TEX, contractsH: H(50), premium: $(46) }],
    fills: [],
  });
  assert.equal(d.certainLiabilityH, 0n);
  assert.equal(d.lines.find((l) => l.marketId === TEX)!.targetH, H(50));
});

test("orders: buy shortfall in whole lots, sell back only excess beyond one lot", () => {
  const lot = H(10);
  const line = (gapH: bigint) => ({
    marketId: TEX,
    label: "Texas",
    liabilityH: 0n,
    targetH: 0n,
    positionH: 0n,
    gapH,
  });
  const desk = (gapH: bigint) => ({
    ...computeEventDesk({ exclusive: false, contracts: [], exposures: [], fills: [] }),
    lines: [line(gapH)],
  });
  assert.deepEqual(planOrders(desk(H(2.5)), lot), [
    { marketId: TEX, side: "BUY", contractsH: H(10) },
  ]);
  assert.deepEqual(planOrders(desk(H(20)), lot), [
    { marketId: TEX, side: "BUY", contractsH: H(20) },
  ]);
  assert.deepEqual(planOrders(desk(-H(15)), lot), [
    { marketId: TEX, side: "SELL", contractsH: H(10) },
  ]);
  assert.deepEqual(planOrders(desk(-H(5)), lot), []);
});

test("walkBook fills across levels and stops at available depth", () => {
  const levels: QuoteLevel[] = [
    { priceMicroUsd: "900000", quantity: "5" },
    { priceMicroUsd: "910000", quantity: "3" },
  ];
  assert.deepEqual(walkBook(levels, H(6)), { filledH: H(6), amount: $(5 * 0.9 + 0.91) });
  assert.deepEqual(walkBook(levels, H(20)).filledH, H(8));
  assert.deepEqual(walkBook([], H(1)), { filledH: 0n, amount: 0n });
});

// ---- runner against the store, with a scripted Gemini --------------------------------------

async function seed(store: MemoryStore, marketId: string, sales: number, price: number, n: string) {
  const promo = await store.createPromotion({
    promoPda: `PROMO_${n}`,
    promoNonce: n,
    mint: "MINT",
    merchant: `MERCHANT_${n}`,
    itemName: "Latte",
    shopName: `Shop ${n}`,
    location: "",
    offerAmount: 5_000_000n,
    depositDeadline: 2_000_000_000,
    geminiMarketId: marketId,
    outcomeLabel: "x",
    maxYesPriceMicroUsd: 1_000_000n,
    hedgeBudget: 10_000_000_000n,
  });
  for (let i = 0; i < sales; i++) {
    const { purchase } = await store.recordDeposit(
      {
        signature: `SIG_${n}_${i}`,
        eventIndex: 0,
        slot: i,
        blockTime: null,
        commitment: "finalized",
        promo: promo.promoPda!,
        purchase: `PUR_${n}_${i}`,
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
      marketId,
      quoteId: null,
      status: "SIMULATED_FILLED",
      failureReason: null,
      requestedContracts: "5",
      filledContracts: "5",
      avgFillPriceMicroUsd: String(Math.round(price * 1e6)),
      premium: $(5 * price),
      modeledFee: 0n,
      assumptions: [],
      quoteFetchedAt: new Date().toISOString(),
    });
  }
  return promo;
}

function stubGemini(bookFails = false) {
  const book = (ask: string, bid: string) => ({
    asks: [{ priceMicroUsd: ask, quantity: "100000" }],
    bids: [{ priceMicroUsd: bid, quantity: "100000" }],
    fetchedAt: new Date().toISOString(),
  });
  return {
    getEventInfo: async () => ({
      eventTicker: EVENT,
      title: "Arkansas vs Texas",
      exclusive: true,
      contracts,
    }),
    getBook: async (marketId: string) => {
      if (bookFails) throw new Error("gemini down");
      return marketId === TEX ? book("920000", "910000") : book("90000", "70000");
    },
  } satisfies Pick<GeminiAdapter, "getEventInfo" | "getBook">;
}

test("desk runner: nets two shops, buys the residual once, sells back after opposite flow", async () => {
  const store = new MemoryStore();
  await seed(store, TEX, 100, 0.92, "1"); // 500 Texas contracts
  await seed(store, ARK, 60, 0.09, "2"); // 300 Arkansas contracts
  const desk = createDesk({ store, gemini: stubGemini(), lotContracts: 10 });

  const r1 = await desk.rebalance();
  assert.deepEqual([r1.orders, r1.filled], [1, 1]);
  assert.equal(store.deskFills[0]!.contracts, "200");
  assert.equal(store.deskFills[0]!.side, "BUY");
  const snap = await desk.snapshot();
  const ev = snap.events[0]!;
  assert.equal(ev.covered, true);
  assert.equal(ev.certainLiability, "300");
  assert.equal(ev.savings, $(487 - 184).toString());
  assert.equal(snap.simulated, true);

  // Idempotent: nothing to do on the next pass.
  assert.equal((await desk.rebalance()).orders, 0);

  // A third shop brings 40 more Arkansas lattes (200 contracts): certain part grows to 500,
  // the Texas residual drops to 0, so the desk sells back its 200 Texas contracts at the bid.
  await seed(store, ARK, 40, 0.09, "3");
  const r3 = await desk.rebalance();
  assert.equal(r3.filled, 1);
  const sell = store.deskFills[1]!;
  assert.deepEqual([sell.side, sell.contracts, sell.marketId], ["SELL", "200", TEX]);
  assert.equal((await desk.snapshot()).events[0]!.covered, true);
});

test("desk runner: Gemini down -> skipped and retried later; settled events are left alone", async () => {
  const store = new MemoryStore();
  const promo = await seed(store, TEX, 2, 0.92, "1");
  const down = createDesk({ store, gemini: stubGemini(true), lotContracts: 10 });
  const r = await down.rebalance();
  assert.equal(r.filled, 0);
  assert.equal(r.skipped.length, 1);

  for (const h of await store.listHedgesByPromotion(promo.id)) {
    await store.settleHedge(h.id, { status: "SETTLED_LOSS", virtualPayout: 0n, settledAt: "" });
  }
  const up = createDesk({ store, gemini: stubGemini(), lotContracts: 10 });
  assert.equal((await up.rebalance()).orders, 0, "no trading after the event settled");
});

test("GET /api/desk serves the snapshot, 503 when the desk is off", async () => {
  const store = new MemoryStore();
  await seed(store, TEX, 1, 0.92, "1");
  const desk = createDesk({ store, gemini: stubGemini(), lotContracts: 10 });
  const gemini = {
    ...stubGemini(),
    getOutcome: async (): Promise<MarketOutcome | null> => null,
  } as unknown as GeminiAdapter;
  const on = await buildServer(loadConfig({}), { gemini, store, gateway: null, desk });
  on.log.level = "silent";
  const res = (await on.inject({ url: "/api/desk" })).json();
  assert.equal(res.simulated, true);
  assert.equal(
    res.events[0].contracts.find((c: { marketId: string }) => c.marketId === TEX).liability,
    "5",
  );
  const off = await buildServer(loadConfig({}), { gemini, store, gateway: null });
  off.log.level = "silent";
  assert.equal((await off.inject({ url: "/api/desk" })).statusCode, 503);
  await on.close();
  await off.close();
});
