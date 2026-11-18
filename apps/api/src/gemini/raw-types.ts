/**
 * Minimal shapes of Gemini prediction-market responses that we actually read. Fields are optional
 * where Gemini may omit them; everything else in the payload is ignored. Observed live on
 * 2026-11-16 (e.g. event NCAAF-2611212030-ARK-TEX-M).
 */

export interface RawContract {
  id: string;
  label: string;
  ticker: string;
  /** e.g. "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX". Used as our marketId. */
  instrumentSymbol: string;
  /** "active" | "settled" | ... (MarketStatus enum). */
  status: string;
  /** "open" | "closed" | ... */
  marketState?: string;
  prices?: {
    bestBid?: string | null;
    bestAsk?: string | null;
    lastTradePrice?: string | null;
  };
  expiryDate?: string | null;
  /** When the contract's observation window starts (strike capture for crypto Up/Down). */
  effectiveDate?: string | null;
  /** "yes" | "no" once the contract is officially settled; null before. */
  resolutionSide?: string | null;
  resolvedAt?: string | null;
}

export interface RawEvent {
  id: string;
  ticker: string;
  title: string;
  category: string;
  /** MarketStatus: approved | active | closed | under_review | settled | invalid */
  status: string;
  expiryDate?: string | null;
  /** Kickoff / event start for sports (observed on NCAAF games); may be absent elsewhere. */
  startTime?: string | null;
  resolvedAt?: string | null;
  contracts: RawContract[];
  /** Sibling markets of the same game (spreads, totals, ...), each with its own contracts. */
  events?: RawEvent[];
}

export interface RawEventsPage {
  data: RawEvent[];
  pagination: { limit: number; offset: number; total: number };
}

export interface RawBookEntry {
  price: string;
  amount: string;
  timestamp?: string;
}

export interface RawBook {
  bids: RawBookEntry[];
  asks: RawBookEntry[];
}

export interface RawStrike {
  type?: string;
  /** Decimal string; absent/null until captured at availableAt. */
  value?: string | null;
  availableAt?: string | null;
}
