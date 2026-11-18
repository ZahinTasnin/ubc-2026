import type { GeminiAdapter } from "./adapter";

/**
 * Short-lived cache in front of the Gemini adapter. Without it every directory view, dashboard,
 * desk pass and checkout pre-check calls Gemini directly (getQuote = 2 requests), so a handful of
 * open screens polling every few seconds would hit Gemini's rate limit; a 429 then shows every
 * promo as PAUSED (no live price). With it, concurrent identical requests share one call and
 * results are reused for a few seconds.
 *
 * Freshness is preserved: a cached quote keeps its original `fetchedAt`, so the hedge simulator's
 * staleness check still sees its true age. Errors are never cached.
 */
export interface CacheTtls {
  quoteMs: number;
  bookMs: number;
  marketMs: number;
  eventMs: number;
  listMs: number;
  outcomeMs: number;
}

export const DEFAULT_TTLS: CacheTtls = {
  quoteMs: 2_000,
  bookMs: 2_000,
  marketMs: 10_000,
  eventMs: 60_000,
  listMs: 5_000,
  outcomeMs: 3_000,
};

const MAX_ENTRIES = 2_000;

export function withGeminiCache(
  inner: GeminiAdapter,
  ttl: CacheTtls = DEFAULT_TTLS,
  now: () => number = Date.now,
): GeminiAdapter {
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  function cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const t = now();
    const hit = entries.get(key);
    if (hit && hit.expires > t) return hit.value as Promise<T>;
    if (entries.size >= MAX_ENTRIES) {
      for (const [k, e] of entries) if (e.expires <= t) entries.delete(k);
      if (entries.size >= MAX_ENTRIES) entries.clear();
    }
    const value = load();
    entries.set(key, { expires: t + ms, value });
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  }

  return {
    listMarkets: (opts) =>
      cached(`markets:${JSON.stringify(opts ?? {})}`, ttl.listMs, () => inner.listMarkets(opts)),
    getMarket: (id) => cached(`market:${id}`, ttl.marketMs, () => inner.getMarket(id)),
    listWindows: (asset, opts) =>
      cached(`windows:${asset}:${JSON.stringify(opts ?? {})}`, ttl.listMs, () =>
        inner.listWindows(asset, opts),
      ),
    getQuote: (id) => cached(`quote:${id}`, ttl.quoteMs, () => inner.getQuote(id)),
    getOutcome: (id) => cached(`outcome:${id}`, ttl.outcomeMs, () => inner.getOutcome(id)),
    listGameLines: (ticker, opts) =>
      cached(`lines:${ticker}:${JSON.stringify(opts ?? {})}`, ttl.listMs, () =>
        inner.listGameLines(ticker, opts),
      ),
    getEventInfo: (ticker) =>
      cached(`event:${ticker}`, ttl.eventMs, () => inner.getEventInfo(ticker)),
    getBook: (id) => cached(`book:${id}`, ttl.bookMs, () => inner.getBook(id)),
  };
}
