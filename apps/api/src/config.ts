export interface ApiConfig {
  host: string;
  port: number;
  corsOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  return {
    host: env.API_HOST ?? "0.0.0.0",
    port,
    corsOrigin: env.API_CORS_ORIGIN ?? "http://localhost:3000",
  };
}
