import type { MarketSummary } from "@hedged/shared";

/**
 * Rules for a promo's on-chain `deposit_deadline` relative to its Gemini market.
 *
 * The escrow only lets `resolve_promo` run at/after the deadline, and the backend only hedges while
 * a live order book exists, so the deadline has to sit inside the market's tradeable life.
 *
 * Sports markets: deposits stop at the event start (`startsAt` = kickoff) so nobody buys once the
 * game is under way. Other standard markets: at expiry (their start time can be in the past).
 *
 * Crypto Up/Down windows (e.g. SOL05M...): the market resolves against the price captured at
 * `opensAt`, and the order book for the NEXT window to open was observed empty from ~5 minutes
 * before it opens (live checks 2026-11-17, 01:00 and 01:03 UTC). So deposits must stop
 * UP_DOWN_BOOK_CLOSE_SECS before `opensAt`. This also means nobody can buy once the strike is
 * known. If Gemini's book behaves differently, the hedge simply fails and the deposit is refunded.
 */
export const UP_DOWN_BOOK_CLOSE_SECS = 300;
/** Leave time for the merchant to sign initialize_promo and for at least one purchase. */
export const MIN_DEPOSIT_WINDOW_SECS = 60;

type MarketTiming = Pick<MarketSummary, "marketKind" | "opensAt" | "expiresAt" | "marketState"> &
  Partial<Pick<MarketSummary, "startsAt" | "category">>;

const unix = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

/** Latest deposit deadline (unix seconds) that keeps purchases hedgeable, or null if unknown. */
export function latestDepositDeadline(market: MarketTiming): number | null {
  if (market.marketKind === "UP_DOWN") {
    const opens = unix(market.opensAt);
    return opens === null ? null : opens - UP_DOWN_BOOK_CLOSE_SECS;
  }
  const kickoff = market.category === "Sports" ? unix(market.startsAt ?? null) : null;
  return kickoff ?? unix(market.expiresAt);
}

export type DeadlineCheck =
  | { ok: true; latest: number }
  | {
      ok: false;
      reason:
        | "MARKET_NOT_OPEN"
        | "MARKET_TIMING_UNKNOWN"
        | "DEADLINE_TOO_SOON"
        | "DEADLINE_AFTER_LAST_HEDGEABLE_TIME";
      latest: number | null;
    };

export function checkDepositDeadline(
  market: MarketTiming,
  depositDeadline: number,
  nowUnix: number,
): DeadlineCheck {
  const latest = latestDepositDeadline(market);
  if (market.marketState !== "open") return { ok: false, reason: "MARKET_NOT_OPEN", latest };
  if (latest === null) return { ok: false, reason: "MARKET_TIMING_UNKNOWN", latest };
  if (depositDeadline < nowUnix + MIN_DEPOSIT_WINDOW_SECS) {
    return { ok: false, reason: "DEADLINE_TOO_SOON", latest };
  }
  if (depositDeadline > latest) {
    return { ok: false, reason: "DEADLINE_AFTER_LAST_HEDGEABLE_TIME", latest };
  }
  return { ok: true, latest };
}
