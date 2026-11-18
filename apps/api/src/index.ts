import { loadConfig } from "./config";
import { createGeminiAdapter } from "./gemini/adapter";
import { createGeminiClient } from "./gemini/client";
import { FakeSolanaGateway } from "./orchestration/fake-gateway";
import { createOrchestrator } from "./orchestration/orchestrator";
import { startWorkers, type RunningWorkers } from "./orchestration/workers";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";

const config = loadConfig();
const gemini = createGeminiAdapter(createGeminiClient(config.gemini));
// TODO(Dev 4): Supabase-backed Store. Until then everything is in memory and lost on restart.
const store = new MemoryStore();
const gateway =
  config.workers.gateway === "fake"
    ? new FakeSolanaGateway(() => Math.floor(Date.now() / 1000))
    : null;
const app = await buildServer(config, { gemini, store, gateway });
app.log.warn("Using the IN-MEMORY store: data is lost on restart (Supabase store pending).");

let workers: RunningWorkers | null = null;

try {
  await app.listen({ host: config.host, port: config.port });

  if (gateway) {
    app.log.warn(
      "SOLANA_GATEWAY=fake: workers run against an IN-MEMORY FAKE chain. Not Solana. Local testing only.",
    );
    const orchestrator = createOrchestrator({
      store,
      gateway,
      gemini,
      config: {
        maxQuoteAgeMs: config.hedge.maxQuoteAgeMs,
        feeBps: config.hedge.feeBps,
        hedgeWindowFraction: config.workers.hedgeWindowFraction,
        retry: { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 4000 },
      },
      log: app.log,
    });
    workers = await startWorkers({
      gateway,
      store,
      orchestrator,
      log: app.log,
      resolvePollMs: config.workers.resolvePollMs,
      reconcileMs: config.workers.reconcileMs,
    });
  } else {
    app.log.info("SOLANA_GATEWAY=none: background workers disabled");
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await workers?.stop();
    await app.close();
    process.exit(0);
  });
}
