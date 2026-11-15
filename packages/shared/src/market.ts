import type { IsoTimestamp, PriceMicroUsd } from "./money";

/** One level of the order book. Quantity is whole contracts. */
export interface QuoteLevel {
  priceMicroUsd: PriceMicroUsd;
  quantity: string;
}

/**
 * READ-ONLY live Gemini Predictions quote. Never invent values; if live data fails, there is no
 * MarketQuote — surface an error instead.
 */
export interface MarketQuote {
  source: "gemini-predictions";
  marketId: string;
  fetchedAt: IsoTimestamp;
  /** Best YES ask, micro-USD per $1-payout contract. */
  yesAskMicroUsd: PriceMicroUsd;
  /** Ask-side depth, best first. */
  asks: QuoteLevel[];
}

/** Official final settlement of the EXACT market (never inferred from price/score). */
export interface MarketOutcome {
  marketId: string;
  outcome: "YES" | "NO";
  /** Where the finality info came from. "manual-demo-fixture" must be clearly labeled in UIs. */
  source: "gemini-official-settlement" | "manual-demo-fixture";
  resolvedAt: IsoTimestamp;
  fetchedAt: IsoTimestamp;
}
