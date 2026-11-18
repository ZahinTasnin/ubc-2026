import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiConfig } from "./config";
import { createGeminiAdapter, type GeminiAdapter } from "./gemini/adapter";
import { createGeminiClient } from "./gemini/client";
import { registerHealthRoute } from "./routes/health";
import { registerMarketRoutes } from "./routes/markets";
import { registerPromotionRoutes } from "./routes/promotions";
import { registerPurchaseRoutes } from "./routes/purchases";
import { registerMerchantRoutes } from "./routes/merchants";

export async function buildServer(
  config: ApiConfig,
  gemini: GeminiAdapter = createGeminiAdapter(createGeminiClient(config.gemini)),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: config.corsOrigin });

  registerHealthRoute(app);
  registerMarketRoutes(app, gemini, config.hedge);
  registerPromotionRoutes(app);
  registerPurchaseRoutes(app);
  registerMerchantRoutes(app);
  return app;
}
