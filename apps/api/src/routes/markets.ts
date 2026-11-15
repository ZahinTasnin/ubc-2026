import type { FastifyInstance } from "fastify";
import { notImplemented } from "./not-implemented";

export function registerMarketRoutes(app: FastifyInstance): void {
  // TODO(Dev 3): list read-only Gemini markets
  app.get("/api/markets", async (_req, reply) => notImplemented(reply, "GET /api/markets"));
  // TODO(Dev 3): live quote with source/timestamp; 503 if unavailable (never invent prices)
  app.get("/api/markets/:id/quote", async (_req, reply) =>
    notImplemented(reply, "GET /api/markets/:id/quote"),
  );
}
