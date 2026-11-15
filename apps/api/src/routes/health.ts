import type { FastifyInstance } from "fastify";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async () => ({
    status: "ok",
    service: "hedged-api",
    time: new Date().toISOString(),
  }));
}
