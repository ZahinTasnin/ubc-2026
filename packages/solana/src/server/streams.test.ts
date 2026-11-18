import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import fixtures from "../__fixtures__/escrow-logs.json";
import { ESCROW_IDL } from "../idl";
import {
  computeStreamsSignature,
  handleStreamsWebhook,
  parseStreamsPayload,
  runStreamsFilterLocally,
  streamsFilterSource,
  timestampFresh,
  verifyStreamsSignature,
} from "./streams";

const TOKEN = "test-token-0123456789abcdef0123456789";
const BODY = '{"matchedTransactions":[]}';
const SIG_A = "5".repeat(87);
const SIG_B = "4".repeat(88);

test("HMAC matches an independently computed vector (Python hmac, sha256 hex)", () => {
  assert.equal(
    computeStreamsSignature(TOKEN, "nonce-1", "1794970000", BODY),
    "09b79e027c5625b41fdf825f982a41764751d5193191db4fc1ff05ae1033d64f",
  );
});

test("verifyStreamsSignature rejects tampering, wrong token and missing headers", () => {
  const sig = computeStreamsSignature(TOKEN, "n", "1", BODY);
  assert.equal(verifyStreamsSignature(TOKEN, "n", "1", BODY, sig), true);
  assert.equal(verifyStreamsSignature(TOKEN, "n", "1", BODY + " ", sig), false);
  assert.equal(
    verifyStreamsSignature("other-token-xxxxxxxxxxxxxxxxxxxxxxxxx", "n", "1", BODY, sig),
    false,
  );
  assert.equal(verifyStreamsSignature(TOKEN, undefined, "1", BODY, sig), false);
  assert.equal(verifyStreamsSignature(TOKEN, "n", "1", BODY, "zz"), false);
});

test("timestamp freshness accepts seconds or ms, rejects stale", () => {
  const now = 1_800_000_000_000;
  assert.equal(timestampFresh("1800000000", 600, now), true);
  assert.equal(timestampFresh("1800000000000", 600, now), true);
  assert.equal(timestampFresh("1799990000", 600, now), false);
  assert.equal(timestampFresh(undefined, 600, now), false);
});

test("webhook: gzip bodies are verified over the uncompressed JSON; bad HMAC is 401", () => {
  const body = JSON.stringify({
    matchedTransactions: [{ signature: SIG_A, slot: 7, events: [{ name: "DepositEvent" }] }],
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = {
    "x-qn-nonce": "abc",
    "x-qn-timestamp": ts,
    "x-qn-signature": computeStreamsSignature(TOKEN, "abc", ts, body),
    "content-encoding": "gzip",
  };
  const seen: string[] = [];
  const ok = handleStreamsWebhook(
    { headers, rawBody: gzipSync(body) },
    { securityToken: TOKEN, onSignals: (s) => seen.push(...s.map((x) => x.signature)) },
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, [SIG_A]);
  const bad = handleStreamsWebhook(
    { headers: { ...headers, "x-qn-signature": "00" }, rawBody: gzipSync(body) },
    { securityToken: TOKEN, onSignals: () => assert.fail("must not dispatch") },
  );
  assert.equal(bad.status, 401);
});

test("parseStreamsPayload: filter output, raw programs_with_logs, junk, duplicates", () => {
  assert.deepEqual(
    parseStreamsPayload({
      matchedTransactions: [{ signature: SIG_A, slot: 1 }, { signature: SIG_A }],
    }).map((s) => s.signature),
    [SIG_A],
  );
  assert.deepEqual(
    parseStreamsPayload({
      data: [
        [
          { signature: SIG_B, slot: 2, success: true },
          { signature: SIG_A, success: false },
        ],
      ],
    }).map((s) => s.signature),
    [SIG_B],
  );
  assert.deepEqual(parseStreamsPayload({ matchedTransactions: [{ signature: "not-a-sig" }] }), []);
  assert.deepEqual(parseStreamsPayload(null), []);
});

test("filter.js discriminators match the IDL (sha256 'event:'/'global:' prefixes)", () => {
  const src = streamsFilterSource();
  const disc = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  for (const ev of ESCROW_IDL.events as unknown as { name: string; discriminator: number[] }[]) {
    const hex = Buffer.from(ev.discriminator).toString("hex");
    assert.equal(hex, disc(`event:${ev.name}`));
    assert.ok(src.includes(hex) && src.includes(`"${ev.name}"`), `filter lacks ${ev.name}`);
  }
  for (const ix of ESCROW_IDL.instructions as unknown as {
    name: string;
    discriminator: number[];
  }[]) {
    const hex = Buffer.from(ix.discriminator).toString("hex");
    assert.ok(src.includes(hex), `filter lacks instruction ${ix.name}`);
  }
  assert.ok(src.includes(ESCROW_IDL.address));
});

test("filter.js on a programs_with_logs batch: keeps escrow txs, labels events, drops the rest", () => {
  const fx = fixtures as unknown as Record<string, { logs: string[] }>;
  const escrow = {
    signature: SIG_A,
    slot: 10,
    blockTime: 1,
    programInvocations: [{ programId: ESCROW_IDL.address, instruction: { index: 0, data: "" } }],
    logs: fx.DepositEvent!.logs,
    success: true,
  };
  const failed = { ...escrow, signature: SIG_B, success: false };
  const other = {
    signature: "3".repeat(88),
    slot: 10,
    programInvocations: [{ programId: "11111111111111111111111111111111" }],
    logs: [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ],
    success: true,
  };
  const out = runStreamsFilterLocally({
    data: [[escrow, failed, other]],
    metadata: { network: "solana-devnet" },
  }) as {
    network: string;
    matchedTransactions: { signature: string; events: { name: string; index: number }[] }[];
  };
  assert.equal(out.network, "solana-devnet");
  assert.deepEqual(
    out.matchedTransactions.map((t) => t.signature),
    [SIG_A],
  );
  assert.deepEqual(
    out.matchedTransactions[0]!.events.map((e) => [e.index, e.name]),
    [[0, "DepositEvent"]],
  );
  assert.equal(runStreamsFilterLocally({ data: [[other]] }), null);
  assert.equal(runStreamsFilterLocally({ data: [] }), null);
});
