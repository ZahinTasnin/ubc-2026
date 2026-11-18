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
const app = await buildServer(config, gemini);

let workers: RunningWorkers | null = null;

try {
  await app.listen({ host: config.host, port: config.port });

  if (config.workers.gateway === "fake") {
    app.log.warn(
      "SOLANA_GATEWAY=fake: workers run against an IN-MEMORY FAKE chain and store. Not Solana; " +
        "nothing is durable. Local testing only.",
    );
    const gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
    const store = new MemoryStore();
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
