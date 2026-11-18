import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOutcome, MarketQuote } from "@hedged/shared";
import { hundredthsToQty, qtyToHundredths, usdToMicro } from "../gemini/decimal";
import { settleHedge, simulateHedge, type HedgePolicy } from "./simulate";

const NOW = new Date("2026-11-16T18:00:00.000Z");
const FIVE_DOLLARS = 5_000_000n;

function quote(asks: [string, string][], fetchedAt = NOW.toISOString()): MarketQuote {
  return {
    source: "gemini-predictions",
    marketId: "GEMI-TEST-EVT-TEX",
    fetchedAt,
    yesAskMicroUsd: asks[0]?.[0] ?? "0",
    asks: asks.map(([priceMicroUsd, quantity]) => ({ priceMicroUsd, quantity })),
  };
}

const policy = (p: Partial<HedgePolicy> = {}): HedgePolicy => ({
  maxYesPriceMicroUsd: 1_000_000n,
  maxQuoteAgeMs: 15_000,
  remainingBudget: null,
  feeBps: 0,
  ...p,
});

test("decimal helpers are exact", () => {
  assert.equal(usdToMicro("0.93"), 930_000n);
  assert.equal(usdToMicro("1"), 1_000_000n);
  assert.equal(qtyToHundredths("1040.0"), 104_000n);
  assert.equal(qtyToHundredths("0.019"), 1n); // floors past 0.01
  assert.equal(hundredthsToQty(450n), "4.5");
  assert.equal(hundredthsToQty(500n), "5");
  assert.throws(() => usdToMicro("-0.1"));
  assert.throws(() => usdToMicro("1e-3"));
});

test("$5 refund at $0.34 = 5 contracts, $1.70 premium (the pitch example)", () => {
  const r = simulateHedge(
    { refundAmount: FIVE_DOLLARS, quote: quote([["340000", "100"]]), policy: policy() },
    NOW,
  );
  assert.equal(r.status, "SIMULATED_FILLED");
  assert.equal(r.requestedContracts, "5");
  assert.equal(r.filledContracts, "5");
  assert.equal(r.premium, "1700000");
  assert.equal(r.avgFillPriceMicroUsd, "340000");
  assert.equal(r.simulated, true);
});

test("walks depth across levels and reports a weighted average", () => {
  const r = simulateHedge(
    {
      refundAmount: FIVE_DOLLARS,
      quote: quote([
        ["340000", "2"],
        ["350000", "10"],
      ]),
      policy: policy(),
    },
    NOW,
  );
  // 2 @ 0.34 + 3 @ 0.35 = 0.68 + 1.05 = 1.73
  assert.equal(r.premium, "1730000");
  assert.equal(r.avgFillPriceMicroUsd, "346000");
});

test("fractional refunds round contracts up to 0.01", () => {
  const r = simulateHedge(
    { refundAmount: 4_505_000n, quote: quote([["500000", "100"]]), policy: policy() },
    NOW,
  );
  assert.equal(r.requestedContracts, "4.51");
});

test("price above merchant cap fails (e.g. Texas at 93c with a 50c cap)", () => {
  const r = simulateHedge(
    {
      refundAmount: FIVE_DOLLARS,
      quote: quote([["930000", "1000"]]),
      policy: policy({ maxYesPriceMicroUsd: 500_000n }),
    },
    NOW,
  );
  assert.equal(r.status, "FAILED");
  assert.equal(r.failureReason, "QUOTE_OVER_CAP");
  assert.equal(r.premium, null);
});

test("depth that runs past the cap is a partial fill, not a success", () => {
  const r = simulateHedge(
    {
      refundAmount: FIVE_DOLLARS,
      quote: quote([
        ["340000", "3"],
        ["600000", "100"],
      ]),
      policy: policy({ maxYesPriceMicroUsd: 400_000n }),
    },
    NOW,
  );
  assert.equal(r.status, "SIMULATED_PARTIAL");
  assert.equal(r.failureReason, "PARTIAL_FILL");
  assert.equal(r.filledContracts, "3");
});

test("stale quote fails", () => {
  const old = new Date(NOW.getTime() - 60_000).toISOString();
  const r = simulateHedge(
    { refundAmount: FIVE_DOLLARS, quote: quote([["340000", "100"]], old), policy: policy() },
    NOW,
  );
  assert.equal(r.failureReason, "QUOTE_STALE");
});

test("empty book fails as unavailable", () => {
  const r = simulateHedge({ refundAmount: FIVE_DOLLARS, quote: quote([]), policy: policy() }, NOW);
  assert.equal(r.failureReason, "QUOTE_UNAVAILABLE");
});

test("premium over remaining budget fails", () => {
  const r = simulateHedge(
    {
      refundAmount: FIVE_DOLLARS,
      quote: quote([["340000", "100"]]),
      policy: policy({ remainingBudget: 1_000_000n }),
    },
    NOW,
  );
  assert.equal(r.failureReason, "BUDGET_EXCEEDED");
});

test("modeled fee is added to premium", () => {
  const r = simulateHedge(
    {
      refundAmount: FIVE_DOLLARS,
      quote: quote([["340000", "100"]]),
      policy: policy({ feeBps: 100 }),
    },
    NOW,
  );
  assert.equal(r.modeledFee, "17000");
  assert.equal(r.premium, "1717000");
});

test("settlement: YES pays $1 per contract, NO pays zero", () => {
  const hedge = {
    status: "SIMULATED_FILLED" as const,
    filledContracts: "5",
    marketId: "GEMI-TEST-EVT-TEX",
  };
  const outcome = (o: "YES" | "NO"): MarketOutcome => ({
    marketId: hedge.marketId,
    outcome: o,
    source: "gemini-official-settlement",
    resolvedAt: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
  });
  assert.deepEqual(settleHedge(hedge, outcome("YES")), {
    status: "SETTLED_WIN",
    virtualPayout: "5000000",
    settledAt: NOW.toISOString(),
  });
  assert.equal(settleHedge(hedge, outcome("NO")).virtualPayout, "0");
  assert.throws(() => settleHedge({ ...hedge, status: "FAILED" }, outcome("YES")));
  assert.throws(() => settleHedge(hedge, { ...outcome("YES"), marketId: "GEMI-OTHER-X" }));
});
