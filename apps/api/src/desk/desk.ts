import type { QuoteLevel } from "@hedged/shared";
import { BASE_UNITS_PER_HUNDREDTH, ceilDiv, qtyToHundredths } from "../gemini/decimal";

/**
 * EXPOSURE DESK (simulated). Every sale is still priced individually against the live book (that is
 * what the shop pays, see hedging/simulate.ts). The desk sits behind those per-sale hedges and decides
 * what the platform actually needs to hold across ALL shops, per Gemini event:
 *
 * - Liability L[c]: $1-payout contracts owed if contract c resolves YES (sum over live hedged sales).
 * - Exclusive events (a moneyline: exactly one side can win): the platform owes at least
 *   m = min_c L[c] whatever happens. That part is certain, so it is covered by the premiums already
 *   collected instead of by contracts. Only the residual L[c] - m is hedged. If premiums cannot cover
 *   m, nothing is netted.
 * - Non-exclusive events (spreads, totals: several lines can win together): no netting, T[c] = L[c].
 * - Orders go out in lots (fewer, larger orders, as an exchange with fees and minimums would need),
 *   rounded up so the desk is never under-hedged. Excess beyond one lot (because opposite flow
 *   arrived later) is sold back at the bid.
 *
 * Units: contracts in hundredths (bigint), money in base units = micro-USD (bigint).
 */

export interface Exposure {
  marketId: string;
  /** Contracts owed if this contract resolves YES (hundredths). */
  contractsH: bigint;
  /** Premium the shop paid for these per-sale hedges (base units). */
  premium: bigint;
}

export interface DeskFill {
  marketId: string;
  side: "BUY" | "SELL";
  contractsH: bigint;
  /** Base units paid (BUY) or received (SELL). */
  amount: bigint;
}

export interface ContractLine {
  marketId: string;
  label: string;
  liabilityH: bigint;
  targetH: bigint;
  positionH: bigint;
  /** target - position: > 0 under-hedged, < 0 over-hedged. */
  gapH: bigint;
}

export interface EventDesk {
  exclusive: boolean;
  lines: ContractLine[];
  premiumsCollected: bigint;
  /** Liability covered by premiums instead of contracts (exclusive events only). */
  certainLiabilityH: bigint;
  /** Net amount the desk spent on contracts (buys - sells). */
  deskCost: bigint;
  /** What hedging every sale separately would have cost (= premiums) minus what the desk spent. */
  savings: bigint;
  /** Exclusive events: platform result if each contract wins. */
  pnlIfWins: { marketId: string; pnl: bigint }[] | null;
  /** Non-negative in every outcome (exclusive) / no gaps (non-exclusive). */
  covered: boolean;
}

export function computeEventDesk(input: {
  exclusive: boolean;
  contracts: { marketId: string; label: string }[];
  exposures: Exposure[];
  fills: DeskFill[];
}): EventDesk {
  const ids = new Set([
    ...input.contracts.map((c) => c.marketId),
    ...input.exposures.map((e) => e.marketId),
    ...input.fills.map((f) => f.marketId),
  ]);
  const label = new Map(input.contracts.map((c) => [c.marketId, c.label]));
  const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

  const liability = new Map<string, bigint>();
  const position = new Map<string, bigint>();
  for (const id of ids) {
    liability.set(
      id,
      sum(input.exposures.filter((e) => e.marketId === id).map((e) => e.contractsH)),
    );
    position.set(
      id,
      sum(
        input.fills
          .filter((f) => f.marketId === id)
          .map((f) => (f.side === "BUY" ? f.contractsH : -f.contractsH)),
      ),
    );
  }
  const premiumsCollected = sum(input.exposures.map((e) => e.premium));
  const deskCost = sum(input.fills.map((f) => (f.side === "BUY" ? f.amount : -f.amount)));

  // Netting needs every outcome of an exclusive event to be listed.
  const allOutcomes = input.contracts.map((c) => c.marketId);
  let certainH = 0n;
  if (input.exclusive && allOutcomes.length >= 2) {
    const m = allOutcomes.reduce(
      (min, id) => (liability.get(id)! < min ? liability.get(id)! : min),
      liability.get(allOutcomes[0]!)!,
    );
    // Only net what the collected premiums can actually pay.
    certainH = m * BASE_UNITS_PER_HUNDREDTH <= premiumsCollected ? m : 0n;
  }

  const lines: ContractLine[] = [...ids].sort().map((id) => {
    const liabilityH = liability.get(id)!;
    const targetH = liabilityH - certainH > 0n ? liabilityH - certainH : 0n;
    const positionH = position.get(id)!;
    return {
      marketId: id,
      label: label.get(id) ?? id,
      liabilityH,
      targetH,
      positionH,
      gapH: targetH - positionH,
    };
  });

  const cash = premiumsCollected - deskCost;
  const pnlIfWins = input.exclusive
    ? lines.map((l) => ({
        marketId: l.marketId,
        pnl: cash + (l.positionH - l.liabilityH) * BASE_UNITS_PER_HUNDREDTH,
      }))
    : null;
  const covered = pnlIfWins
    ? pnlIfWins.every((o) => o.pnl >= 0n) && cash >= 0n
    : lines.every((l) => l.gapH <= 0n);

  return {
    exclusive: input.exclusive,
    lines,
    premiumsCollected,
    certainLiabilityH: certainH,
    deskCost,
    savings: premiumsCollected - deskCost,
    pnlIfWins,
    covered,
  };
}

export interface PlannedOrder {
  marketId: string;
  side: "BUY" | "SELL";
  contractsH: bigint;
}

/** Buy any shortfall rounded UP to whole lots; sell back only excess beyond one lot. */
export function planOrders(desk: EventDesk, lotH: bigint): PlannedOrder[] {
  const orders: PlannedOrder[] = [];
  for (const l of desk.lines) {
    if (l.gapH > 0n) {
      orders.push({ marketId: l.marketId, side: "BUY", contractsH: ceilDiv(l.gapH, lotH) * lotH });
    } else if (-l.gapH >= lotH) {
      const excess = -l.gapH;
      orders.push({ marketId: l.marketId, side: "SELL", contractsH: (excess / lotH) * lotH });
    }
  }
  return orders;
}

/**
 * Walk one side of the live book (asks for BUY, bids for SELL, best first). Returns what would
 * fill and its total amount. Assumes the book does not move and the desk is the only taker.
 */
export function walkBook(levels: QuoteLevel[], wantH: bigint): { filledH: bigint; amount: bigint } {
  let filledH = 0n;
  let times100 = 0n;
  for (const level of levels) {
    if (filledH === wantH) break;
    const take =
      wantH - filledH < qtyToHundredths(level.quantity)
        ? wantH - filledH
        : qtyToHundredths(level.quantity);
    filledH += take;
    times100 += take * BigInt(level.priceMicroUsd);
  }
  return { filledH, amount: ceilDiv(times100, 100n) };
}
