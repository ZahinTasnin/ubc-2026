import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { computeStreamsSignature, type StreamsSignal } from "@hedged/solana/server";
import { loadConfig } from "../config";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";

const TOKEN = "test-streams-token";
const SIG = "5".repeat(87);

async function server(streams: boolean) {
  const received: StreamsSignal[][] = [];
  const app = await buildServer(loadConfig({}), {
    store: new MemoryStore(),
    gateway: null,
    streams: streams ? { securityToken: TOKEN, ingest: (s) => received.push(s) } : null,
  });
  app.log.level = "silent";
  return { app, received };
}

function signed(payload: string, opts: { token?: string; gzip?: boolean; ts?: number } = {}) {
  const nonce = "n-1";
  const timestamp = String(opts.ts ?? Math.floor(Date.now() / 1000));
  return {
    headers: {
      "content-type": "application/json",
      "x-qn-nonce": nonce,
      "x-qn-timestamp": timestamp,
      "x-qn-signature": computeStreamsSignature(opts.token ?? TOKEN, nonce, timestamp, payload),
      ...(opts.gzip ? { "content-encoding": "gzip" } : {}),
    },
    payload: opts.gzip ? gzipSync(payload) : payload,
  };
}

const delivery = JSON.stringify({
  matchedTransactions: [
    { signature: SIG, slot: 42, instructions: ["deposit"], events: [{ name: "DepositEvent" }] },
  ],
});

test("streams webhook: a correctly signed delivery is handed to the gateway", async () => {
  const { app, received } = await server(true);
  const res = await app.inject({ method: "POST", url: "/webhooks/quicknode", ...signed(delivery) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, signatures: 1 });
  assert.deepEqual(received, [[{ signature: SIG, slot: 42, events: ["DepositEvent"] }]]);
  await app.close();
});

test("streams webhook: gzip bodies are accepted (signature is over the decompressed JSON)", async () => {
  const { app, received } = await server(true);
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/quicknode",
    ...signed(delivery, { gzip: true }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(received.length, 1);
  await app.close();
});

test("streams webhook: wrong token, stale timestamp, tampered body are rejected", async () => {
  const { app, received } = await server(true);
  const bad = await app.inject({
    method: "POST",
    url: "/webhooks/quicknode",
    ...signed(delivery, { token: "wrong" }),
  });
  assert.equal(bad.statusCode, 401);
  const stale = await app.inject({
    method: "POST",
    url: "/webhooks/quicknode",
    ...signed(delivery, { ts: Math.floor(Date.now() / 1000) - 3600 }),
  });
  assert.equal(stale.statusCode, 401);
  const s = signed(delivery);
  const tampered = await app.inject({
    method: "POST",
    url: "/webhooks/quicknode",
    headers: s.headers,
    payload: delivery.replace("42", "43"),
  });
  assert.equal(tampered.statusCode, 401);
  assert.equal(received.length, 0);
  await app.close();
});

test("streams webhook disabled -> 503; JSON routes still parse JSON normally", async () => {
  const { app } = await server(false);
  const res = await app.inject({ method: "POST", url: "/webhooks/quicknode", ...signed(delivery) });
  assert.equal(res.statusCode, 503);
  // The raw-body parser is scoped to the webhook: /api/promotions still validates JSON fields.
  const json = await app.inject({
    method: "POST",
    url: "/api/promotions",
    payload: { merchant: "bad" },
  });
  assert.equal(json.statusCode, 400);
  assert.equal(json.json().field, "merchant");
  await app.close();
});

test("config accepts SOLANA_GATEWAY=real and reads the Streams token", () => {
  const c = loadConfig({ SOLANA_GATEWAY: "real", QUICKNODE_STREAMS_SECURITY_TOKEN: "t" });
  assert.equal(c.workers.gateway, "real");
  assert.equal(c.workers.streamsSecurityToken, "t");
  assert.throws(() => loadConfig({ SOLANA_GATEWAY: "mainnet" }));
});
