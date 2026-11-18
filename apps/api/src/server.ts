import cors from "@fastify/cors";
import type { SolanaServerGateway } from "@hedged/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiConfig } from "./config";
import { createGeminiAdapter, type GeminiAdapter } from "./gemini/adapter";
import { createGeminiClient } from "./gemini/client";
import { registerHealthRoute } from "./routes/health";
import { registerMarketRoutes } from "./routes/markets";
import { registerPromotionRoutes } from "./routes/promotions";
import { registerPurchaseRoutes } from "./routes/purchases";
import type { Store } from "./store/types";

export interface ServerDeps {
  gemini?: GeminiAdapter;
  store: Store;
  /** null when SOLANA_GATEWAY=none: promos can be drafted but not confirmed. */
  gateway: SolanaServerGateway | null;
}

export async function buildServer(config: ApiConfig, deps: ServerDeps): Promise<FastifyInstance> {
  const gemini = deps.gemini ?? createGeminiAdapter(createGeminiClient(config.gemini));
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: config.corsOrigin });

  registerHealthRoute(app);
  registerMarketRoutes(app, gemini, config.hedge);
  registerPromotionRoutes(app, { gemini, store: deps.store, gateway: deps.gateway });
  registerPurchaseRoutes(app);
  return app;
}
