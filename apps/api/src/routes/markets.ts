import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiConfig } from "../config";
import {
  MarketNotFoundError,
  MarketNotOpenError,
  QuoteUnavailableError,
  type GeminiAdapter,
} from "../gemini/adapter";
import { GeminiNotFoundError, GeminiUnavailableError } from "../gemini/client";
import { simulateHedge } from "../hedging/simulate";

const UINT_RE = /^\d{1,18}$/;

export function registerMarketRoutes(
  app: FastifyInstance,
  gemini: GeminiAdapter,
  hedge: ApiConfig["hedge"],
): void {
  // Live read-only listing. ?search=Texas&category=Sports&limit=50
  app.get<{ Querystring: { search?: string; category?: string; limit?: string; offset?: string } }>(
    "/api/markets",
    async (req, reply) => {
      const limit = clampInt(req.query.limit, 50, 1, 100);
      const offset = clampInt(req.query.offset, 0, 0, 10_000);
      try {
        const { total, markets } = await gemini.listMarkets({
          search: req.query.search,
          category: req.query.category,
          limit,
          offset,
        });
        return { source: "gemini-predictions", totalEvents: total, markets };
      } catch (err) {
        return sendGeminiError(reply, err);
      }
    },
  );

  // Live quote (real order book). Add ?refundAmount=5000000 to also get a SIMULATED hedge
  // estimate; ?maxYesPriceMicroUsd=500000 applies a merchant cap to that estimate.
  app.get<{
    Params: { id: string };
    Querystring: { refundAmount?: string; maxYesPriceMicroUsd?: string };
  }>("/api/markets/:id/quote", async (req, reply) => {
    const { refundAmount, maxYesPriceMicroUsd } = req.query;
    if (
      refundAmount !== undefined &&
      (!UINT_RE.test(refundAmount) || BigInt(refundAmount) === 0n)
    ) {
      return reply.code(400).send({ error: "invalid_refund_amount" });
    }
    if (maxYesPriceMicroUsd !== undefined && !UINT_RE.test(maxYesPriceMicroUsd)) {
      return reply.code(400).send({ error: "invalid_max_yes_price" });
    }
    try {
      const result = await gemini.getQuote(req.params.id);
      const estimate =
        refundAmount === undefined
          ? null
          : simulateHedge({
              refundAmount: BigInt(refundAmount),
              quote: result.quote,
              policy: {
                maxYesPriceMicroUsd: BigInt(maxYesPriceMicroUsd ?? "1000000"),
                maxQuoteAgeMs: hedge.maxQuoteAgeMs,
                remainingBudget: null,
                feeBps: hedge.feeBps,
              },
            });
      return { ...result, estimate };
    } catch (err) {
      return sendGeminiError(reply, err);
    }
  });

  // Official Gemini settlement for one contract. outcome=null means not settled yet.
  app.get<{ Params: { id: string } }>("/api/markets/:id/outcome", async (req, reply) => {
    try {
      return { marketId: req.params.id, outcome: await gemini.getOutcome(req.params.id) };
    } catch (err) {
      return sendGeminiError(reply, err);
    }
  });
}

function sendGeminiError(reply: FastifyReply, err: unknown) {
  if (err instanceof MarketNotFoundError || err instanceof GeminiNotFoundError) {
    return reply.code(404).send({ error: "market_not_found", message: err.message });
  }
  if (err instanceof MarketNotOpenError) {
    return reply.code(409).send({ error: "market_not_open", marketState: err.marketState });
  }
  if (err instanceof QuoteUnavailableError) {
    return reply.code(503).send({ error: "quote_unavailable", message: err.message });
  }
  if (err instanceof GeminiUnavailableError) {
    reply.log.warn({ err }, "gemini unavailable");
    return reply.code(503).send({ error: "gemini_unavailable", message: err.message });
  }
  throw err;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
