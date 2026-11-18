import type {
  Hedge,
  HedgeFailureReason,
  HedgeStatus,
  MarketOutcome,
  MarketQuote,
  TokenBaseUnits,
} from "@hedged/shared";
import {
  BASE_UNITS_PER_HUNDREDTH,
  ceilDiv,
  hundredthsToQty,
  qtyToHundredths,
} from "../gemini/decimal";

/**
 * SIMULATED hedge model. Pure functions, no I/O. Nothing here places an order: it answers "if the
 * merchant bought YES contracts against this live order book right now, what would it cost?"
 *
 * Sizing: one $1-payout YES contract per $1 of refund liability, rounded UP to Gemini's 0.01
 * contract increment so the virtual payout always covers the refund.
 * Fill model: walk the live ask side from the best price, taking depth only at prices <= the
 * merchant's cap. Assumes we are the only taker and the book does not move (no latency/slippage
 * beyond the observed levels). Fees are a configurable bps on premium; 0 = not modeled.
 */

export interface HedgePolicy {
  /** Merchant's max acceptable YES price, micro-USD per contract. */
  maxYesPriceMicroUsd: bigint;
  /** Quotes older than this are rejected as stale. */
  maxQuoteAgeMs: number;
  /** Remaining hedge budget for the promotion in base units; null = no budget limit. */
  remainingBudget: bigint | null;
  /** Modeled trading fee in basis points of premium. 0 means fees are not modeled. */
  feeBps: number;
}

export interface SimulatedHedgeResult {
  simulated: true;
  marketId: string;
  status: Extract<HedgeStatus, "SIMULATED_FILLED" | "SIMULATED_PARTIAL" | "FAILED">;
  failureReason: HedgeFailureReason | null;
  requestedContracts: string;
  filledContracts: string;
  avgFillPriceMicroUsd: string | null;
  /** Contract cost + modeled fee, base units. Null when nothing could be filled. */
  premium: TokenBaseUnits | null;
  modeledFee: TokenBaseUnits;
  quoteFetchedAt: string;
  /** Plain-language list of what the simulation assumed, for UI/receipts. */
  assumptions: string[];
}

export function simulateHedge(
  input: { refundAmount: bigint; quote: MarketQuote; policy: HedgePolicy },
  now: Date = new Date(),
): SimulatedHedgeResult {
  const { refundAmount, quote, policy } = input;
  if (refundAmount <= 0n) throw new Error("refundAmount must be positive");

  const requested = ceilDiv(refundAmount, BASE_UNITS_PER_HUNDREDTH);
  const assumptions = [
    "Simulated only: no Gemini order was placed.",
    "Fills assume the observed order book stays unchanged and we are the only buyer.",
    policy.feeBps > 0
      ? `Trading fee modeled at ${policy.feeBps} bps of premium.`
      : "Gemini trading fees are not modeled.",
  ];
  const base = {
    simulated: true as const,
    marketId: quote.marketId,
    requestedContracts: hundredthsToQty(requested),
    quoteFetchedAt: quote.fetchedAt,
    assumptions,
  };
  const fail = (reason: HedgeFailureReason): SimulatedHedgeResult => ({
    ...base,
    status: "FAILED",
    failureReason: reason,
    filledContracts: "0",
    avgFillPriceMicroUsd: null,
    premium: null,
    modeledFee: "0",
  });

  const ageMs = now.getTime() - Date.parse(quote.fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs > policy.maxQuoteAgeMs) return fail("QUOTE_STALE");
  if (quote.asks.length === 0) return fail("QUOTE_UNAVAILABLE");
  if (BigInt(quote.yesAskMicroUsd) > policy.maxYesPriceMicroUsd) return fail("QUOTE_OVER_CAP");

  // Walk depth within the cap. cost is in micro-USD (= base units): hundredths * price / 100.
  let filled = 0n;
  let costTimes100 = 0n;
  for (const level of quote.asks) {
    const price = BigInt(level.priceMicroUsd);
    if (price > policy.maxYesPriceMicroUsd) break;
    const take = minBig(requested - filled, qtyToHundredths(level.quantity));
    filled += take;
    costTimes100 += take * price;
    if (filled === requested) break;
  }
  if (filled === 0n) return fail("INSUFFICIENT_LIQUIDITY");

  const contractCost = ceilDiv(costTimes100, 100n);
  const modeledFee = ceilDiv(contractCost * BigInt(policy.feeBps), 10_000n);
  const premium = contractCost + modeledFee;
  const avgFill = ceilDiv(costTimes100, filled);

  if (policy.remainingBudget !== null && premium > policy.remainingBudget) {
    return fail("BUDGET_EXCEEDED");
  }

  const partial = filled < requested;
  return {
    ...base,
    status: partial ? "SIMULATED_PARTIAL" : "SIMULATED_FILLED",
    // A partial fill does not cover the refund; orchestration must retry or cancel (CLAUDE.md §5).
    failureReason: partial ? "PARTIAL_FILL" : null,
    filledContracts: hundredthsToQty(filled),
    avgFillPriceMicroUsd: avgFill.toString(),
    premium: premium.toString(),
    modeledFee: modeledFee.toString(),
  };
}

/**
 * Settle a simulated hedge against an OFFICIAL outcome. YES pays $1 per filled contract into the
 * virtual ledger; NO pays nothing. No real funds move.
 */
export function settleHedge(
  hedge: Pick<Hedge, "status" | "filledContracts" | "marketId">,
  outcome: MarketOutcome,
): Pick<Hedge, "status" | "virtualPayout" | "settledAt"> {
  if (hedge.status !== "SIMULATED_FILLED" && hedge.status !== "SIMULATED_PARTIAL") {
    throw new Error(`Cannot settle hedge in status ${hedge.status}`);
  }
  if (outcome.marketId !== hedge.marketId) {
    throw new Error(`Outcome market ${outcome.marketId} does not match hedge ${hedge.marketId}`);
  }
  const payout =
    outcome.outcome === "YES"
      ? qtyToHundredths(hedge.filledContracts) * BASE_UNITS_PER_HUNDREDTH
      : 0n;
  return {
    status: outcome.outcome === "YES" ? "SETTLED_WIN" : "SETTLED_LOSS",
    virtualPayout: payout.toString(),
    settledAt: outcome.resolvedAt,
  };
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
