import type { FastifyInstance } from "fastify";

/**
 * Per-IP fixed-window limit on write requests (POST). The write routes need no login (drafts are
 * harmless until a merchant signs on-chain), but with the Supabase store every draft is persisted
 * and every confirm costs an RPC read, so unlimited POSTs could fill the database or burn RPC
 * credits. QuickNode's webhook is exempt: it is HMAC-authenticated and sends bursts.
 */
export function registerWriteRateLimit(
  app: FastifyInstance,
  opts: { maxPerWindow: number; windowMs: number; now?: () => number },
): void {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "POST" || req.url.startsWith("/webhooks/")) return;
    const t = now();
    const key = req.ip;
    let w = windows.get(key);
    if (!w || t - w.start >= opts.windowMs) {
      if (windows.size > 10_000) windows.clear();
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count++;
    if (w.count > opts.maxPerWindow) {
      const retryAfter = Math.ceil((w.start + opts.windowMs - t) / 1000);
      return reply
        .code(429)
        .header("retry-after", String(retryAfter))
        .send({ error: "rate_limited", retryAfterSeconds: retryAfter });
    }
  });
}
