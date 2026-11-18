import type { EventInfo, GeminiAdapter } from "../gemini/adapter";
import { parseMarketId } from "../gemini/adapter";
import { ceilDiv, hundredthsToQty, qtyToHundredths } from "../gemini/decimal";
import type { Logger } from "../orchestration/orchestrator";
import type { Store } from "../store/types";
import {
  computeEventDesk,
  planOrders,
  walkBook,
  type DeskFill,
  type EventDesk,
  type Exposure,
} from "./desk";

const COUNTED = new Set(["SIMULATED_FILLED", "SETTLED_WIN", "SETTLED_LOSS"]);

export interface DeskDeps {
  store: Store;
  gemini: Pick<GeminiAdapter, "getEventInfo" | "getBook">;
  /** Order size step, in whole contracts. */
  lotContracts: number;
  log?: Logger;
}

interface EventState {
  eventTicker: string;
  info: EventInfo | null;
  exposures: Exposure[];
  fills: DeskFill[];
  /** At least one per-sale hedge on this event is still open (not settled). */
  live: boolean;
}

export function createDesk(deps: DeskDeps) {
  const lotH = BigInt(deps.lotContracts) * 100n;

  async function collect(): Promise<EventState[]> {
    const events = new Map<string, EventState>();
    const get = (ticker: string) => {
      let e = events.get(ticker);
      if (!e) {
        e = { eventTicker: ticker, info: null, exposures: [], fills: [], live: false };
        events.set(ticker, e);
      }
      return e;
    };

    for (const promo of await deps.store.listPromotions({ status: "ACTIVE" })) {
      for (const h of await deps.store.listHedgesByPromotion(promo.id)) {
        if (!COUNTED.has(h.status)) continue;
        const e = get(parseMarketId(h.marketId).eventTicker);
        e.exposures.push({
          marketId: h.marketId,
          contractsH: qtyToHundredths(h.filledContracts),
          premium: h.premium ?? 0n,
        });
        if (h.status === "SIMULATED_FILLED") e.live = true;
      }
    }
    for (const f of await deps.store.listDeskFills()) {
      get(f.eventTicker).fills.push({
        marketId: f.marketId,
        side: f.side,
        contractsH: qtyToHundredths(f.contracts),
        amount: f.amount,
      });
    }
    await Promise.all(
      [...events.values()].map(async (e) => {
        e.info = await deps.gemini.getEventInfo(e.eventTicker).catch(() => null);
      }),
    );
    return [...events.values()];
  }

  const compute = (e: EventState): EventDesk =>
    computeEventDesk({
      // Without event info we cannot prove exclusivity: never net then.
      exclusive: e.info?.exclusive ?? false,
      contracts: e.info?.contracts ?? [],
      exposures: e.exposures,
      fills: e.fills,
    });

  /** Current desk view for every event with exposure or desk positions. */
  async function snapshot() {
    const events = (await collect()).map((e) => ({ state: e, desk: compute(e) }));
    const total = (pick: (d: EventDesk) => bigint) =>
      events.reduce((s, { desk }) => s + pick(desk), 0n).toString();
    return {
      simulated: true as const,
      lotContracts: deps.lotContracts,
      totals: {
        premiumsCollected: total((d) => d.premiumsCollected),
        deskCost: total((d) => d.deskCost),
        savings: total((d) => d.savings),
      },
      events: events.map(({ state, desk }) => ({
        eventTicker: state.eventTicker,
        title: state.info?.title ?? null,
        exclusive: desk.exclusive,
        live: state.live,
        covered: desk.covered,
        premiumsCollected: desk.premiumsCollected.toString(),
        deskCost: desk.deskCost.toString(),
        savings: desk.savings.toString(),
        certainLiability: hundredthsToQty(desk.certainLiabilityH),
        contracts: desk.lines.map((l) => ({
          marketId: l.marketId,
          label: l.label,
          liability: hundredthsToQty(l.liabilityH),
          target: hundredthsToQty(l.targetH),
          position: hundredthsToQty(l.positionH),
          gap: (l.gapH < 0n ? "-" : "") + hundredthsToQty(l.gapH < 0n ? -l.gapH : l.gapH),
        })),
        pnlIfWins:
          desk.pnlIfWins?.map((o) => ({ marketId: o.marketId, pnl: o.pnl.toString() })) ?? null,
      })),
    };
  }

  /**
   * Bring every live event back to its target: buy shortfalls in whole lots, sell back excess
   * beyond one lot. All fills are simulated against the live book and recorded.
   */
  async function rebalance(): Promise<{ orders: number; filled: number; skipped: string[] }> {
    let orders = 0;
    let filled = 0;
    const skipped: string[] = [];
    for (const e of await collect()) {
      if (!e.live) continue; // event settled: nothing left to hedge
      if (!e.info) {
        // Without event info we can't tell if netting applies; trading anyway could buy the full
        // gross exposure and sell it back once info returns. Wait for the next pass instead.
        skipped.push(`${e.eventTicker}: event info unavailable`);
        continue;
      }
      for (const order of planOrders(compute(e), lotH)) {
        orders++;
        let book;
        try {
          book = await deps.gemini.getBook(order.marketId);
        } catch (err) {
          skipped.push(`${order.marketId}: ${String(err)}`);
          continue;
        }
        const fill = walkBook(order.side === "BUY" ? book.asks : book.bids, order.contractsH);
        if (fill.filledH === 0n) {
          skipped.push(`${order.marketId}: no ${order.side === "BUY" ? "asks" : "bids"}`);
          continue;
        }
        await deps.store.recordDeskFill({
          eventTicker: e.eventTicker,
          marketId: order.marketId,
          side: order.side,
          contracts: hundredthsToQty(fill.filledH),
          amount: fill.amount,
          avgPriceMicroUsd: ceilDiv(fill.amount * 100n, fill.filledH).toString(),
          quoteFetchedAt: book.fetchedAt,
        });
        filled++;
        deps.log?.info(
          {
            event: e.eventTicker,
            market: order.marketId,
            side: order.side,
            contracts: hundredthsToQty(fill.filledH),
          },
          "desk fill (simulated)",
        );
      }
    }
    if (skipped.length) deps.log?.warn({ skipped }, "desk orders not filled; will retry");
    return { orders, filled, skipped };
  }

  return { snapshot, rebalance };
}

export type Desk = ReturnType<typeof createDesk>;
