import assert from "node:assert/strict";
import { test } from "node:test";
import { createGeminiAdapter } from "./adapter";
import type { GeminiClient } from "./client";

/** Canned Gemini responses shaped like the live ones observed on 2026-11-17. */
function stubClient(routes: Record<string, unknown>): GeminiClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      if (!(path in routes)) throw new Error(`unexpected path ${path}`);
      return routes[path] as T;
    },
  };
}

const solEvent = (ticker: string, opens: string, expires: string) => ({
  id: ticker,
  ticker,
  title: "SOL price today",
  category: "Crypto",
  status: "active",
  contracts: [
    {
      id: `${ticker}-1`,
      label: "Up",
      ticker: "UP",
      instrumentSymbol: `GEMI-${ticker}-UP`,
      status: "active",
      marketState: "open",
      effectiveDate: opens,
      expiryDate: expires,
    },
  ],
});

test("listWindows: soonest SOL 5-minute windows with book, strike and deadline", async () => {
  const now = new Date("2026-11-18T01:03:27Z");
  const client = stubClient({
    "/v1/prediction-markets/events": {
      data: [
        solEvent("SOL05M2611180110", "2026-11-18T01:05:00.000Z", "2026-11-18T01:10:00.000Z"),
        solEvent("SOL05M2611180105", "2026-11-18T01:00:00.000Z", "2026-11-18T01:05:00.000Z"),
        solEvent("SOL05M2611180055", "2026-11-18T00:50:00.000Z", "2026-11-18T00:55:00.000Z"), // ended
        solEvent("SOL15M2611180115", "2026-11-18T01:00:00.000Z", "2026-11-18T01:15:00.000Z"), // 15-min
        solEvent("BTC05M2611180110", "2026-11-18T01:05:00.000Z", "2026-11-18T01:10:00.000Z"), // other asset
      ],
      pagination: { limit: 100, offset: 0, total: 5 },
    },
    "/v1/book/GEMI-SOL05M2611180105-UP": { bids: [], asks: [{ price: "0.05", amount: "2.04" }] },
    "/v1/book/GEMI-SOL05M2611180110-UP": { bids: [], asks: [] },
    "/v1/prediction-markets/events/SOL05M2611180105/strike": {
      type: "reference",
      value: "74.95609624166667",
      availableAt: "2026-11-18T01:00:00.000Z",
    },
    "/v1/prediction-markets/events/SOL05M2611180110/strike": {
      type: "reference",
      availableAt: "2026-11-18T01:05:00.000Z",
    },
  });
  const windows = await createGeminiAdapter(client, () => now).listWindows("SOL");

  assert.deepEqual(
    windows.map((w) => [w.eventTicker, w.phase, w.bestAskMicroUsd, w.strikeUsd]),
    [
      ["SOL05M2611180105", "open", "50000", "74.95609624166667"],
      ["SOL05M2611180110", "upcoming", null, null],
    ],
  );
  assert.equal(windows[0]!.askDepthContracts, "2.04");
  assert.equal(windows[1]!.recommendedDepositDeadline, Date.parse("2026-11-18T01:00:00Z") / 1000);
});

test("getMarket tags crypto Up/Down vs standard markets", async () => {
  const client = stubClient({
    "/v1/prediction-markets/events/SOL05M2611180110": solEvent(
      "SOL05M2611180110",
      "2026-11-18T01:05:00.000Z",
      "2026-11-18T01:10:00.000Z",
    ),
    "/v1/prediction-markets/events/NCAAF-2611212030-ARK-TEX-M": {
      ...solEvent("NCAAF-2611212030-ARK-TEX-M", "2026-11-13T00:00:00Z", "2026-11-22T20:30:00Z"),
      contracts: [
        {
          ...solEvent("X", "2026-11-13T00:00:00Z", "2026-11-22T20:30:00Z").contracts[0],
          instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
        },
      ],
    },
  });
  const adapter = createGeminiAdapter(client);
  assert.equal((await adapter.getMarket("GEMI-SOL05M2611180110-UP")).marketKind, "UP_DOWN");
  assert.equal(
    (await adapter.getMarket("GEMI-NCAAF-2611212030-ARK-TEX-M-TEX")).marketKind,
    "STANDARD",
  );
});
