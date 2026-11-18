import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";

/**
 * QuickNode Streams webhook receiver for Arc (server-only). Same authentication as
 * packages/solana/src/server/streams.ts (copied, not imported: packages may only depend on
 * @hedged/shared): signature = hex(HMAC-SHA256(token, nonce + timestamp + payload)) over the
 * UNCOMPRESSED body, headers X-QN-Nonce / X-QN-Timestamp / X-QN-Signature.
 * https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages
 * A verified delivery yields tx hashes only; the gateway re-fetches and verifies each one.
 */
export interface ArcStreamsSignal {
  txHash: `0x${string}`;
  blockNumber?: number;
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

const TX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Tx hashes from a delivery. Accepts our filter's output (`{ matchedTransactions: [...] }`) and,
 * defensively, the raw `logs` dataset (`data: [[ [log, ...] per tx ]]` per block) filtered to
 * `escrow` if the filter is ever removed.
 */
export function parseArcStreamsPayload(body: unknown, escrow?: string): ArcStreamsSignal[] {
  const out: ArcStreamsSignal[] = [];
  const esc = escrow?.toLowerCase();
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.matchedTransactions)) {
      for (const t of o.matchedTransactions as Record<string, unknown>[]) {
        if (typeof t?.txHash === "string" && TX.test(t.txHash)) {
          out.push({
            txHash: t.txHash as `0x${string}`,
            blockNumber: typeof t.blockNumber === "number" ? t.blockNumber : undefined,
            events: Array.isArray(t.events) ? t.events.map(String) : undefined,
          });
        }
      }
      return;
    }
    if (typeof o.transactionHash === "string" && typeof o.address === "string") {
      if (TX.test(o.transactionHash) && (!esc || o.address.toLowerCase() === esc)) {
        const bn = typeof o.blockNumber === "string" ? parseInt(o.blockNumber, 16) : undefined;
        out.push({ txHash: o.transactionHash as `0x${string}`, blockNumber: bn });
      }
      return;
    }
    if ("data" in o) visit(o.data, depth + 1);
  };
  visit(body, 0);
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.txHash) ? false : (seen.add(s.txHash), true)));
}

export interface StreamsWebhookResult {
  status: number;
  body: { ok: boolean; transactions?: number; error?: string };
}

/** Framework-agnostic handler: pass RAW body bytes + headers. Answers fast; verification is async. */
export function handleArcStreamsWebhook(
  req: {
    headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
  },
  opts: {
    securityToken: string;
    escrow?: string;
    onSignals: (s: ArcStreamsSignal[]) => void;
    maxSkewSec?: number;
  },
): StreamsWebhookResult {
  const h = (k: string) => {
    const v = req.headers[k] ?? req.headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  let raw = typeof req.rawBody === "string" ? Buffer.from(req.rawBody, "utf8") : req.rawBody;
  if ((h("content-encoding") ?? "").includes("gzip") && raw[0] === 0x1f && raw[1] === 0x8b)
    raw = gunzipSync(raw);
  const payload = raw.toString("utf8");
  const nonce = h("x-qn-nonce");
  const timestamp = h("x-qn-timestamp");
  if (!verifyStreamsSignature(opts.securityToken, nonce, timestamp, payload, h("x-qn-signature"))) {
    return { status: 401, body: { ok: false, error: "bad signature" } };
  }
  if (!timestampFresh(timestamp, opts.maxSkewSec))
    return { status: 401, body: { ok: false, error: "stale timestamp" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json" } };
  }
  const signals = parseArcStreamsPayload(parsed, opts.escrow);
  if (signals.length) opts.onSignals(signals);
  return { status: 200, body: { ok: true, transactions: signals.length } };
}

export function startArcStreamsWebhookServer(opts: {
  port: number;
  path?: string;
  securityToken: string;
  escrow?: string;
  onSignals: (s: ArcStreamsSignal[]) => void;
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
      const r = handleArcStreamsWebhook(
        { headers: req.headers, rawBody: Buffer.concat(chunks) },
        { securityToken: opts.securityToken, escrow: opts.escrow, onSignals: opts.onSignals },
      );
      opts.log?.("streams delivery", { status: r.status, transactions: r.body.transactions ?? 0 });
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, () => resolve(server)));
}

/** Filter source with the escrow address substituted (packages/arc/streams/filter.js). */
export function arcStreamsFilterSource(escrow: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(escrow)) throw new Error("escrow must be a 0x address");
  const src = readFileSync(
    fileURLToPath(new URL("../../streams/filter.js", import.meta.url)),
    "utf8",
  );
  return src.replace(`"__ESCROW_ADDRESS__"`, `"${escrow.toLowerCase()}"`);
}

/** Run the filter as Streams would (`main(stream)` in an isolated vm context). Tests and dry runs. */
export function runArcStreamsFilterLocally(
  escrow: string,
  stream: { data: unknown; metadata?: unknown },
): unknown {
  const ctx: { result?: unknown; __stream: unknown } = { __stream: stream };
  runInNewContext(`${arcStreamsFilterSource(escrow)}\nresult = main(__stream);`, ctx, {
    timeout: 2000,
  });
  return ctx.result == null ? null : JSON.parse(JSON.stringify(ctx.result));
}
