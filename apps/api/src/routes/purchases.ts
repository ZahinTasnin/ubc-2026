import type { FastifyInstance } from "fastify";
import { notImplemented } from "./not-implemented";

export function registerPurchaseRoutes(app: FastifyInstance): void {
  // TODO(Dev 3): never trust client-submitted HEDGED/REFUNDED/outcome/price fields
  app.get("/api/purchases/:id", async (_req, reply) =>
    notImplemented(reply, "GET /api/purchases/:id"),
  );
}
