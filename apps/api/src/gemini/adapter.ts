import type { MarketOutcome, MarketQuote, MarketSummary, QuoteLevel } from "@hedged/shared";
import type { GeminiClient } from "./client";
import { qtyToHundredths, hundredthsToQty, usdToMicro, usdToMicroOrNull } from "./decimal";
import type { RawBook, RawContract, RawEvent, RawEventsPage } from "./raw-types";

/**
 * Read-only Gemini Predictions adapter.
 *
 * marketId = the contract's Gemini `instrumentSymbol`, which has the form
 * `GEMI-<eventTicker>-<contractTicker>` (contract tickers contain no "-"). We always confirm the
 * parsed event actually contains a contract with that exact symbol before using it.
 */

export class MarketNotFoundError extends Error {
  constructor(marketId: string) {
    super(`No Gemini contract with instrumentSymbol ${marketId}`);
    this.name = "MarketNotFoundError";
  }
}

export class MarketNotOpenError extends Error {
  constructor(
    marketId: string,
    readonly marketState: string | undefined,
  ) {
    super(`Gemini contract ${marketId} is not open (marketState=${marketState ?? "unknown"})`);
    this.name = "MarketNotOpenError";
  }
}

/** The book has no asks, so no live price exists. We never substitute a made-up price. */
export class QuoteUnavailableError extends Error {
  constructor(marketId: string) {
    super(`Gemini order book for ${marketId} has no asks`);
    this.name = "QuoteUnavailableError";
  }
}

export function parseMarketId(marketId: string): { eventTicker: string; contractTicker: string } {
  const m = /^GEMI-([A-Za-z0-9._-]+)-([A-Za-z0-9._]+)$/.exec(marketId);
  if (!m) throw new MarketNotFoundError(marketId);
  return { eventTicker: m[1]!, contractTicker: m[2]! };
}

export interface ListMarketsOptions {
  search?: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface QuoteResult {
  quote: MarketQuote;
  eventTicker: string;
  eventTitle: string;
  outcomeLabel: string;
  marketState: string | undefined;
}

export interface GeminiAdapter {
  listMarkets(opts?: ListMarketsOptions): Promise<{ total: number; markets: MarketSummary[] }>;
  getQuote(marketId: string): Promise<QuoteResult>;
  /** Official settlement only. Returns null while the contract is not yet settled. */
  getOutcome(marketId: string): Promise<MarketOutcome | null>;
}

export function createGeminiAdapter(
  client: GeminiClient,
  now: () => Date = () => new Date(),
): GeminiAdapter {
  async function getContract(
    marketId: string,
  ): Promise<{ event: RawEvent; contract: RawContract }> {
    const { eventTicker } = parseMarketId(marketId);
    const event = await client.get<RawEvent>(
      `/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`,
    );
    const contract = event.contracts?.find((c) => c.instrumentSymbol === marketId);
    if (!contract) throw new MarketNotFoundError(marketId);
    return { event, contract };
  }

  return {
    async listMarkets(opts = {}) {
      const page = await client.get<RawEventsPage>("/v1/prediction-markets/events", {
        status: opts.status ?? "active",
        category: opts.category,
        search: opts.search,
        limit: opts.limit ?? 50,
        offset: opts.offset,
      });
      const fetchedAt = now().toISOString();
      const markets = page.data.flatMap((event) =>
        (event.contracts ?? [])
          .filter((c) => c.instrumentSymbol)
          .map((c) => toSummary(event, c, fetchedAt)),
      );
      return { total: page.pagination.total, markets };
    },

    async getQuote(marketId) {
      // Check state first: Gemini's book endpoint returns 400 for closed/settled contracts.
      const { event, contract } = await getContract(marketId);
      if (contract.marketState !== "open")
        throw new MarketNotOpenError(marketId, contract.marketState);
      const book = await client.get<RawBook>(`/v1/book/${encodeURIComponent(marketId)}`);

      const asks: QuoteLevel[] = (book.asks ?? [])
        .map((a) => ({ price: usdToMicro(a.price), qty: qtyToHundredths(a.amount) }))
        .filter((a) => a.qty > 0n)
        .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
        .map((a) => ({ priceMicroUsd: a.price.toString(), quantity: hundredthsToQty(a.qty) }));
      const best = asks[0];
      if (!best) throw new QuoteUnavailableError(marketId);

      return {
        quote: {
          source: "gemini-predictions",
          marketId,
          fetchedAt: now().toISOString(),
          yesAskMicroUsd: best.priceMicroUsd,
          asks,
        },
        eventTicker: event.ticker,
        eventTitle: event.title,
        outcomeLabel: contract.label,
        marketState: contract.marketState,
      };
    },

    async getOutcome(marketId) {
      const { contract } = await getContract(marketId);
      const side = contract.resolutionSide;
      // Only an explicit settled status + yes/no resolution counts. Prices near 0/1 do not.
      if (
        contract.status !== "settled" ||
        (side !== "yes" && side !== "no") ||
        !contract.resolvedAt
      ) {
        return null;
      }
      return {
        marketId,
        outcome: side === "yes" ? "YES" : "NO",
        source: "gemini-official-settlement",
        resolvedAt: contract.resolvedAt,
        fetchedAt: now().toISOString(),
      };
    },
  };
}

function toSummary(event: RawEvent, c: RawContract, fetchedAt: string): MarketSummary {
  const micro = (v: string | null | undefined) => usdToMicroOrNull(v)?.toString() ?? null;
  return {
    source: "gemini-predictions",
    marketId: c.instrumentSymbol,
    eventTicker: event.ticker,
    eventTitle: event.title,
    outcomeLabel: c.label,
    category: event.category,
    marketState: c.marketState ?? "unknown",
    bestAskMicroUsd: micro(c.prices?.bestAsk),
    bestBidMicroUsd: micro(c.prices?.bestBid),
    lastTradeMicroUsd: micro(c.prices?.lastTradePrice),
    expiresAt: c.expiryDate ?? event.expiryDate ?? null,
    fetchedAt,
  };
}
