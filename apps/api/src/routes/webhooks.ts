import { handleStreamsWebhook, type StreamsSignal } from "@hedged/solana/server";
import type { FastifyInstance } from "fastify";

/** Where QuickNode Streams deliveries go (packages/solana/README.md "QuickNode Streams"). */
export interface StreamsWebhookDeps {
  /** The Stream's HMAC security token (QUICKNODE_STREAMS_SECURITY_TOKEN). */
  securityToken: string;
  /** Hand signatures to the real gateway, which re-fetches and verifies them before any handler. */
  ingest(signals: StreamsSignal[]): void;
}

/**
 * POST /webhooks/quicknode. Dev 3's `handleStreamsWebhook` checks the X-QN-Signature HMAC over the
 * RAW body, rejects stale timestamps and gunzips if needed, so this route must not JSON-parse
 * first: it runs in its own plugin scope with a raw-buffer body parser (other routes keep JSON).
 * The payload is a notification, not proof; it only triggers verification in the gateway.
 */
export async function registerStreamsWebhook(
  app: FastifyInstance,
  deps: StreamsWebhookDeps | null,
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.post("/webhooks/quicknode", async (req, reply) => {
      if (!deps) return reply.code(503).send({ ok: false, error: "streams_disabled" });
      const result = handleStreamsWebhook(
        { headers: req.headers, rawBody: (req.body as Buffer | undefined) ?? Buffer.alloc(0) },
        { securityToken: deps.securityToken, onSignals: (s) => deps.ingest(s) },
      );
      return reply.code(result.status).send(result.body);
    });
  });
}
