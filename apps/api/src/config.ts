export interface ApiConfig {
  host: string;
  port: number;
  corsOrigin: string;
  gemini: { baseUrl: string; timeoutMs: number };
  hedge: { maxQuoteAgeMs: number; feeBps: number };
  /** Server-only. null = in-memory store (not durable). */
  supabase: { url: string; serviceRoleKey: string } | null;
  /** Exposure desk (simulated netting across shops). */
  desk: { lotContracts: number; rebalanceMs: number };
  workers: {
    /**
     * Which SolanaServerGateway backs the workers:
     * - "none": API only, no background workers (default until Dev 3's gateway lands)
     * - "fake": IN-MEMORY fake chain + in-memory store, for local testing only (not Solana)
     */
    gateway: "none" | "fake";
    resolvePollMs: number;
    reconcileMs: number;
    hedgeWindowFraction: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid API_PORT: ${env.API_PORT}`);

  if ((env.GEMINI_READ_ONLY ?? "true") !== "true") {
    throw new Error('GEMINI_READ_ONLY must be "true": this MVP never trades on Gemini.');
  }

  return {
    host: env.API_HOST ?? "0.0.0.0",
    port,
    corsOrigin: env.API_CORS_ORIGIN ?? "http://localhost:3000",
    gemini: {
      baseUrl: env.GEMINI_API_BASE_URL || "https://api.gemini.com",
      timeoutMs: nonNegativeInt(env.GEMINI_TIMEOUT_MS, 5000, "GEMINI_TIMEOUT_MS"),
    },
    supabase:
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
        : null,
    desk: {
      lotContracts: Math.max(1, nonNegativeInt(env.DESK_LOT_CONTRACTS, 10, "DESK_LOT_CONTRACTS")),
      rebalanceMs: nonNegativeInt(env.DESK_REBALANCE_MS, 15_000, "DESK_REBALANCE_MS"),
    },
    workers: {
      gateway: parseGatewayMode(env.SOLANA_GATEWAY),
      resolvePollMs: nonNegativeInt(env.RESOLVE_POLL_MS, 5000, "RESOLVE_POLL_MS"),
      reconcileMs: nonNegativeInt(env.RECONCILE_MS, 60_000, "RECONCILE_MS"),
      hedgeWindowFraction: 0.7,
    },
    hedge: {
      maxQuoteAgeMs: nonNegativeInt(env.HEDGE_MAX_QUOTE_AGE_MS, 15_000, "HEDGE_MAX_QUOTE_AGE_MS"),
      feeBps: nonNegativeInt(env.HEDGE_FEE_BPS, 0, "HEDGE_FEE_BPS"),
    },
  };
}

function nonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function parseGatewayMode(raw: string | undefined): "none" | "fake" {
  const mode = raw || "none";
  if (mode === "none" || mode === "fake") return mode;
  throw new Error(
    `SOLANA_GATEWAY=${mode} is not supported yet (real @hedged/solana gateway pending); use none or fake`,
  );
}
