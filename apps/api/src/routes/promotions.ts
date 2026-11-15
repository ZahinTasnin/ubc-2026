import type { FastifyInstance } from "fastify";
import { notImplemented } from "./not-implemented";

export function registerPromotionRoutes(app: FastifyInstance): void {
  app.post("/api/promotions", async (_req, reply) => notImplemented(reply, "POST /api/promotions"));
  app.get("/api/promotions/:id", async (_req, reply) =>
    notImplemented(reply, "GET /api/promotions/:id"),
  );
}
