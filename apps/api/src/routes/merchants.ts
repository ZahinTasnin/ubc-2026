import type { FastifyInstance } from "fastify";
import { notImplemented } from "./not-implemented";

export function registerMerchantRoutes(app: FastifyInstance): void {
  // TODO(Dev 3): requires access control before exposing merchant records
  app.get("/api/merchants/:id/dashboard", async (_req, reply) =>
    notImplemented(reply, "GET /api/merchants/:id/dashboard"),
  );
}
