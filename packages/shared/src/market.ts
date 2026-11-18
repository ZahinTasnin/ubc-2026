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

/**
 * One tradeable YES contract, as listed by `GET /api/markets`. `marketId` is the Gemini
 * `instrumentSymbol` (e.g. "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX"); prices are a snapshot from the
 * events listing and may be null when that side of the book is empty.
 */
export interface MarketSummary {
  source: "gemini-predictions";
  marketId: string;
  eventTicker: string;
  eventTitle: string;
  /** Contract label, e.g. "Texas" or "Texas wins by more than 17.5 points". */
  outcomeLabel: string;
  category: string;
  /** Gemini contract `marketState`, e.g. "open" / "closed". */
  marketState: string;
  bestAskMicroUsd: PriceMicroUsd | null;
  bestBidMicroUsd: PriceMicroUsd | null;
  lastTradeMicroUsd: PriceMicroUsd | null;
  expiresAt: IsoTimestamp | null;
  fetchedAt: IsoTimestamp;
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
