import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";

/**
 * QuickNode Streams webhook receiver (server-only).
 *
 * Authentication, per QuickNode's "Validating Incoming Streams Webhook Messages" guide: each
 * delivery carries `X-QN-Nonce`, `X-QN-Timestamp` and `X-QN-Signature`, where
 * signature = hex(HMAC-SHA256(securityToken, nonce + timestamp + payload)) and `payload` is the
 * UNCOMPRESSED JSON body (decompress first when `Content-Encoding: gzip`).
 * https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages
 *
 * A verified delivery is still only a NOTIFICATION: it yields signatures, which the gateway's
 * event pipeline re-fetches over RPC and verifies before anything reaches the backend.
 */

export interface StreamsSignal {
  signature: string;
  slot?: number;
  events?: string[];
}

export function computeStreamsSignature(
  token: string,
  nonce: string,
  timestamp: string,
  payload: string,
): string {
  return createHmac("sha256", Buffer.from(token, "utf8"))
    .update(Buffer.from(nonce + timestamp + payload, "utf8"))
    .digest("hex");
}

export function verifyStreamsSignature(
  token: string,
  nonce: string | undefined,
  timestamp: string | undefined,
  payload: string,
  signature: string | undefined,
): boolean {
  if (!token || !nonce || !timestamp || !signature || !/^[0-9a-fA-F]+$/.test(signature))
    return false;
  const expected = Buffer.from(computeStreamsSignature(token, nonce, timestamp, payload), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Replay guard: reject deliveries whose timestamp is far from now (seconds or ms accepted). */
export function timestampFresh(
  timestamp: string | undefined,
  maxSkewSec = 600,
  nowMs = Date.now(),
): boolean {
  if (!timestamp) return false;
  const n = Number(timestamp);
  if (!Number.isFinite(n)) return true; // non-numeric format: rely on the HMAC + nonce only
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(nowMs - ms) <= maxSkewSec * 1000;
}

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Signatures from a delivery. Accepts our filter's output (`streams/filter.js`:
 * `{ matchedTransactions: [...] }`) and, defensively, the raw `programs_with_logs` shape
 * (`{ data: [[{ signature, slot, ... }]] }` or a bare array) if the filter is ever removed.
 */
export function parseStreamsPayload(body: unknown): StreamsSignal[] {
  const out: StreamsSignal[] = [];
  const push = (t: unknown) => {
    if (!t || typeof t !== "object") return;
    const o = t as { signature?: unknown; slot?: unknown; events?: unknown; success?: unknown };
    if (typeof o.signature !== "string" || !SIG.test(o.signature) || o.success === false) return;
    out.push({
      signature: o.signature,
      slot: typeof o.slot === "number" ? o.slot : undefined,
      events: Array.isArray(o.events)
        ? o.events.map((e) => String((e as { name?: unknown })?.name ?? "unknown"))
        : undefined,
    });
  };
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || v == null) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.matchedTransactions)) return o.matchedTransactions.forEach(push);
    if ("signature" in o) return push(o);
    if ("data" in o) return walk(o.data, depth + 1);
  };
  walk(body, 0);
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.signature) ? false : (seen.add(s.signature), true)));
}

export interface StreamsWebhookResult {
  status: number;
  body: { ok: boolean; signatures?: number; error?: string };
}

/**
 * Framework-agnostic handler. Pass the RAW body bytes (before JSON parsing) and the headers.
 * Responds fast: signatures are handed to `onSignals` without waiting for finality, because
 * Streams delivers sequentially and times out slow endpoints (dropped work is recovered by the
 * RPC sweep).
 */
export function handleStreamsWebhook(
  req: {
    headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
  },
  opts: { securityToken: string; onSignals: (s: StreamsSignal[]) => void; maxSkewSec?: number },
): StreamsWebhookResult {
  const h = (k: string) => {
    const v = req.headers[k] ?? req.headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  let raw = typeof req.rawBody === "string" ? Buffer.from(req.rawBody, "utf8") : req.rawBody;
  if ((h("content-encoding") ?? "").includes("gzip") && raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = gunzipSync(raw);
  }
  const payload = raw.toString("utf8");
  const nonce = h("x-qn-nonce");
  const timestamp = h("x-qn-timestamp");
  if (!verifyStreamsSignature(opts.securityToken, nonce, timestamp, payload, h("x-qn-signature"))) {
    return { status: 401, body: { ok: false, error: "bad signature" } };
  }
  if (!timestampFresh(timestamp, opts.maxSkewSec)) {
    return { status: 401, body: { ok: false, error: "stale timestamp" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json" } };
  }
  const signals = parseStreamsPayload(parsed);
  if (signals.length) opts.onSignals(signals);
  return { status: 200, body: { ok: true, signatures: signals.length } };
}

/** Minimal standalone receiver (node:http) for running the listener outside apps/api. */
export function startStreamsWebhookServer(opts: {
  port: number;
  path?: string;
  securityToken: string;
  onSignals: (s: StreamsSignal[]) => void;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<Server> {
  const path = opts.path ?? "/webhooks/quicknode";
  const server = createServer((req, res) => {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== path) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const r = handleStreamsWebhook(
        { headers: req.headers, rawBody: Buffer.concat(chunks) },
        { securityToken: opts.securityToken, onSignals: opts.onSignals },
      );
      opts.log?.("streams delivery", { status: r.status, signatures: r.body.signatures ?? 0 });
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, () => resolve(server)));
}

/** Source of the QuickNode Streams filter (packages/solana/streams/filter.js). */
export function streamsFilterSource(): string {
  return readFileSync(fileURLToPath(new URL("../../streams/filter.js", import.meta.url)), "utf8");
}

/**
 * Run the filter locally exactly as Streams would (isolated `vm` context, `main(stream)`), for
 * tests and for `streams:create --test`. Not a security boundary: the file is our own code.
 */
export function runStreamsFilterLocally(stream: { data: unknown; metadata?: unknown }): unknown {
  const ctx: { result?: unknown; __stream: unknown } = { __stream: stream };
  runInNewContext(`${streamsFilterSource()}\nresult = main(__stream);`, ctx, { timeout: 2000 });
  // Streams serializes the return value to JSON; do the same (also leaves the vm realm).
  return ctx.result == null ? null : JSON.parse(JSON.stringify(ctx.result));
}
