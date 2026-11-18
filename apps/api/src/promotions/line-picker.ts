import type { GameLine } from "../gemini/adapter";
import { simulateHedge } from "../hedging/simulate";

/**
 * "Which promo line fits my budget?" The merchant gives a per-sale threshold as a share of the item
 * price (e.g. 40% of a $5 latte). For a full refund the hedge cost per sale is (YES price × refund),
 * so the threshold is exactly a cap on the YES price. Every line is priced with the same simulated
 * hedge model used at checkout, against its live book.
 *
 * Suggestion: among lines that fully fill within the threshold, the one with the HIGHEST price,
 * i.e. the outcome most likely to happen: customers get the best chance at a free item for the
 * money the shop is willing to spend.
 */
export interface PricedLine {
  marketId: string;
  eventTitle: string;
  label: string;
  bestAskMicroUsd: string | null;
  /** Simulated hedge cost for one sale at this line (base units), null if it can't be filled. */
  costPerSale: string | null;
  fits: boolean;
  reason: string | null;
}

export function priceLines(
  lines: GameLine[],
  opts: { refundAmount: bigint; maxCostBps: number; maxQuoteAgeMs: number; feeBps: number },
  now: Date,
): { lines: PricedLine[]; suggested: PricedLine | null } {
  const cap = (BigInt(opts.maxCostBps) * 1_000_000n) / 10_000n;
  const priced = lines.map((line): PricedLine => {
    const best = line.asks[0];
    const sim = simulateHedge(
      {
        refundAmount: opts.refundAmount,
        quote: {
          source: "gemini-predictions",
          marketId: line.marketId,
          fetchedAt: line.fetchedAt,
          yesAskMicroUsd: best?.priceMicroUsd ?? "0",
          asks: line.asks,
        },
        policy: {
          maxYesPriceMicroUsd: cap,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          remainingBudget: null,
          feeBps: opts.feeBps,
        },
      },
      now,
    );
    const fits = sim.status === "SIMULATED_FILLED";
    return {
      marketId: line.marketId,
      eventTitle: line.eventTitle,
      label: line.label,
      bestAskMicroUsd: best?.priceMicroUsd ?? null,
      costPerSale: fits ? sim.premium : null,
      fits,
      reason: fits ? null : (sim.failureReason ?? "UNKNOWN"),
    };
  });

  priced.sort((a, b) =>
    Number(BigInt(b.bestAskMicroUsd ?? "0") - BigInt(a.bestAskMicroUsd ?? "0")),
  );
  return { lines: priced, suggested: priced.find((l) => l.fits) ?? null };
}
