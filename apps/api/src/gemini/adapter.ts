import type {
  MarketOutcome,
  MarketQuote,
  MarketSummary,
  MarketWindow,
  QuoteLevel,
} from "@hedged/shared";
import { latestDepositDeadline } from "../promotions/deadline";
import type { GeminiClient } from "./client";
import { qtyToHundredths, hundredthsToQty, usdToMicro, usdToMicroOrNull } from "./decimal";
import type { RawBook, RawContract, RawEvent, RawEventsPage, RawStrike } from "./raw-types";

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

/** Short crypto Up/Down event tickers, e.g. SOL05M2611180105 (asset, window minutes, YYMMDDHHMM). */
const UP_DOWN_TICKER = /^([A-Z]{2,10})(\d{1,3})M(\d{10})$/;

export interface GeminiAdapter {
  listMarkets(opts?: ListMarketsOptions): Promise<{ total: number; markets: MarketSummary[] }>;
  /** One contract's summary (timing, state, snapshot prices). */
  getMarket(marketId: string): Promise<MarketSummary>;
  /** Next short Up/Down windows for an asset (default 5-minute), soonest first. */
  listWindows(
    asset: string,
    opts?: { windowMinutes?: number; limit?: number },
  ): Promise<MarketWindow[]>;
  getQuote(marketId: string): Promise<QuoteResult>;
  /** Official settlement only. Returns null while the contract is not yet settled. */
  getOutcome(marketId: string): Promise<MarketOutcome | null>;
  /**
   * Every open line for one game (the game event plus its spread/total child events), each with its
   * live ask side. `team` keeps lines whose label mentions it (e.g. "Texas"); totals are dropped
   * then, since they are not about one team.
   */
  listGameLines(eventTicker: string, opts?: { team?: string }): Promise<GameLine[]>;
}

export interface GameLine {
  marketId: string;
  eventTicker: string;
  eventTitle: string;
  label: string;
  asks: QuoteLevel[];
  fetchedAt: string;
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

      const asks = parseAsks(book);
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

    async getMarket(marketId) {
      const { event, contract } = await getContract(marketId);
      return toSummary(event, contract, now().toISOString());
    },

    async listWindows(asset, opts = {}) {
      const minutes = opts.windowMinutes ?? 5;
      const limit = opts.limit ?? 8;
      const page = await client.get<RawEventsPage>("/v1/prediction-markets/events", {
        status: "active",
        category: "Crypto",
        search: asset,
        limit: 100,
      });
      const fetchedAt = now();
      const candidates = page.data
        .filter((e) => {
          const m = UP_DOWN_TICKER.exec(e.ticker);
          return m?.[1] === asset && Number(m[2]) === minutes && e.contracts?.length === 1;
        })
        .map((e) => ({ event: e, contract: e.contracts[0]! }))
        .filter(
          ({ contract }) =>
            contract.marketState === "open" &&
            contract.effectiveDate &&
            contract.expiryDate &&
            Date.parse(contract.expiryDate) > fetchedAt.getTime(),
        )
        .sort((a, b) => Date.parse(a.contract.expiryDate!) - Date.parse(b.contract.expiryDate!))
        .slice(0, limit);

      return Promise.all(
        candidates.map(async ({ event, contract }) => {
          // A window can close between the listing and these reads (book then returns 400):
          // show it with an empty book instead of failing the whole list.
          const [book, strike] = await Promise.all([
            client
              .get<RawBook>(`/v1/book/${encodeURIComponent(contract.instrumentSymbol)}`)
              .catch((): RawBook => ({ bids: [], asks: [] })),
            client
              .get<RawStrike>(
                `/v1/prediction-markets/events/${encodeURIComponent(event.ticker)}/strike`,
              )
              .catch((): RawStrike => ({})),
          ]);
          const asks = parseAsks(book);
          const depth = asks.reduce((sum, a) => sum + qtyToHundredths(a.quantity), 0n);
          const summary = toSummary(event, contract, fetchedAt.toISOString());
          return {
            source: "gemini-predictions" as const,
            marketId: contract.instrumentSymbol,
            eventTicker: event.ticker,
            title: event.title,
            asset,
            opensAt: contract.effectiveDate!,
            expiresAt: contract.expiryDate!,
            phase:
              Date.parse(contract.effectiveDate!) <= fetchedAt.getTime()
                ? ("open" as const)
                : ("upcoming" as const),
            strikeUsd: strike.value ?? null,
            strikeAvailableAt: strike.availableAt ?? null,
            bestAskMicroUsd: asks[0]?.priceMicroUsd ?? null,
            askDepthContracts: hundredthsToQty(depth),
            recommendedDepositDeadline: latestDepositDeadline(summary)!,
            fetchedAt: fetchedAt.toISOString(),
          };
        }),
      );
    },

    async listGameLines(eventTicker, opts = {}) {
      const game = await client.get<RawEvent>(
        `/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`,
      );
      const team = opts.team?.toLowerCase();
      const contracts = [game, ...(game.events ?? [])].flatMap((e) =>
        (e.contracts ?? [])
          .filter((c) => c.instrumentSymbol && c.marketState === "open")
          .filter((c) => !team || c.label.toLowerCase().includes(team))
          .map((c) => ({ event: e, contract: c })),
      );
      // Bounded fan-out: one public book request per candidate line.
      return Promise.all(
        contracts.slice(0, 40).map(async ({ event, contract }) => {
          const book = await client
            .get<RawBook>(`/v1/book/${encodeURIComponent(contract.instrumentSymbol)}`)
            .catch(() => ({ bids: [], asks: [] }) as RawBook);
          return {
            marketId: contract.instrumentSymbol,
            eventTicker: event.ticker,
            eventTitle: event.title,
            label: contract.label,
            asks: parseAsks(book),
            fetchedAt: now().toISOString(),
          };
        }),
      );
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
    startsAt: event.startTime ?? null,
    opensAt: c.effectiveDate ?? null,
    marketKind: UP_DOWN_TICKER.test(event.ticker) ? "UP_DOWN" : "STANDARD",
    fetchedAt,
  };
}

/** Ask side of a Gemini book, best (lowest) price first, empty levels dropped. */
function parseAsks(book: RawBook): QuoteLevel[] {
  return (book.asks ?? [])
    .map((a) => ({ price: usdToMicro(a.price), qty: qtyToHundredths(a.amount) }))
    .filter((a) => a.qty > 0n)
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
    .map((a) => ({ priceMicroUsd: a.price.toString(), quantity: hundredthsToQty(a.qty) }));
}
