/**
 * READ-ONLY HTTP client for Gemini's public prediction-market data.
 *
 * Only GET requests to an explicit allowlist of public market-data paths are possible. No API key
 * or signature is ever attached, so this client cannot place orders, read balances or move money
 * even if called with a wrong path. Verified against https://api.gemini.com on 2026-11-16 and
 * https://developer.gemini.com/specs/openapi/prediction-markets.yaml.
 */

const ALLOWED_PATHS: RegExp[] = [
  // List events / event by ticker / recently-settled (all public, no auth).
  /^\/v1\/prediction-markets\/events(\/[A-Za-z0-9._-]+)?$/,
  // Strike (reference price) for crypto Up/Down events.
  /^\/v1\/prediction-markets\/events\/[A-Za-z0-9._-]+\/strike$/,
  // Public order book; prediction contracts use their instrumentSymbol, e.g. GEMI-...-TEX.
  /^\/v1\/book\/[A-Za-z0-9._-]+$/,
];

export interface GeminiClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export class GeminiUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export class GeminiNotFoundError extends Error {
  constructor(path: string) {
    super(`Gemini returned 404 for ${path}`);
    this.name = "GeminiNotFoundError";
  }
}

export type Query = Record<string, string | number | string[] | undefined>;

export interface GeminiClient {
  get<T>(path: string, query?: Query): Promise<T>;
}

export function createGeminiClient(config: GeminiClientConfig): GeminiClient {
  return {
    async get<T>(path: string, query: Query = {}): Promise<T> {
      if (!ALLOWED_PATHS.some((re) => re.test(path))) {
        throw new Error(`Refusing non-allowlisted Gemini path (read-only client): ${path}`);
      }
      const url = new URL(path, config.baseUrl);
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value])
          url.searchParams.append(key, String(v));
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json", "user-agent": "hedged-promos-api" },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err) {
        throw new GeminiUnavailableError(`Gemini request failed: ${path}`, err);
      }
      if (res.status === 404) throw new GeminiNotFoundError(path);
      if (!res.ok) throw new GeminiUnavailableError(`Gemini returned ${res.status} for ${path}`);
      try {
        return (await res.json()) as T;
      } catch (err) {
        throw new GeminiUnavailableError(`Gemini returned invalid JSON for ${path}`, err);
      }
    },
  };
}
