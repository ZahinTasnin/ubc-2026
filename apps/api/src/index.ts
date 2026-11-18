import type { SolanaServerGateway } from "@hedged/shared";
import {
  createSolanaGatewayFromEnv,
  type RealSolanaGateway,
  type StreamsSignal,
} from "@hedged/solana/server";
import { loadConfig } from "./config";
import { createGeminiAdapter } from "./gemini/adapter";
import { createGeminiClient } from "./gemini/client";
import { FakeSolanaGateway } from "./orchestration/fake-gateway";
import { createOrchestrator } from "./orchestration/orchestrator";
import { startWorkers, type RunningWorkers } from "./orchestration/workers";
import { createDesk } from "./desk/run";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";
import { createSupabaseStore } from "./store/supabase-store";
import type { Store } from "./store/types";

const config = loadConfig();
const gemini = createGeminiAdapter(createGeminiClient(config.gemini));
const store: Store = config.supabase
  ? createSupabaseStore(config.supabase.url, config.supabase.serviceRoleKey)
  : new MemoryStore();
// Background workers run on one of: nothing ("none"), an in-memory fake chain ("fake"), or Dev 3's
// real Devnet gateway ("real", built from the SOLANA_* / QUICKNODE_* / RELAYER_* variables).
let realGateway: RealSolanaGateway | null = null;
let gateway: SolanaServerGateway | null = null;
if (config.workers.gateway === "fake") {
  gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
} else if (config.workers.gateway === "real") {
  realGateway = await createSolanaGatewayFromEnv(process.env, (msg, extra) =>
    console.log(JSON.stringify({ level: 30, time: Date.now(), msg: `[solana] ${msg}`, ...extra })),
  );
  gateway = realGateway;
}
const streams =
  realGateway && config.workers.streamsSecurityToken
    ? {
        securityToken: config.workers.streamsSecurityToken,
        ingest: (signals: StreamsSignal[]) => realGateway!.ingestStreams(signals),
      }
    : null;
const desk = createDesk({
  store,
  gemini,
  lotContracts: config.desk.lotContracts,
});
const app = await buildServer(config, { gemini, store, gateway, desk, streams });
if (config.supabase) {
  app.log.info({ supabase: new URL(config.supabase.url).host }, "using Supabase store");
} else {
  app.log.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set: IN-MEMORY store, lost on restart");
}

let workers: RunningWorkers | null = null;

try {
  await app.listen({ host: config.host, port: config.port });

  if (gateway) {
    if (config.workers.gateway === "fake") {
      app.log.warn(
        "SOLANA_GATEWAY=fake: workers run against an IN-MEMORY FAKE chain. Not Solana. Local testing only.",
      );
    } else {
      app.log.info(
        {
          streamsWebhook: Boolean(streams),
          eventSource: process.env.SOLANA_EVENT_SOURCE ?? "websocket",
        },
        "SOLANA_GATEWAY=real: workers run on Solana Devnet",
      );
      if (process.env.SOLANA_EVENT_SOURCE === "streams" && !streams) {
        app.log.warn("SOLANA_EVENT_SOURCE=streams but QUICKNODE_STREAMS_SECURITY_TOKEN is not set");
      }
    }
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
      desk,
      deskMs: config.desk.rebalanceMs,
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
    await realGateway?.stop();
    await app.close();
    process.exit(0);
  });
}
