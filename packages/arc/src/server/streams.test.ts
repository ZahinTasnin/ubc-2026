import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { encodeAbiParameters, encodeEventTopics, getAddress, pad } from "viem";
import { HEDGED_ESCROW_ABI } from "../abi";
import { decodeEscrowLogs } from "../codec";
import {
  computeStreamsSignature,
  handleArcStreamsWebhook,
  parseArcStreamsPayload,
  runArcStreamsFilterLocally,
  timestampFresh,
} from "./streams";
import { checkTokenConservation, tokenMoves } from "./verify";

const ESC = getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3");
const TOKEN = getAddress("0x3600000000000000000000000000000000000000");
const ALICE = getAddress("0x00000000000000000000000000000000000000a1");
const PROMO = pad("0x01");
const PURCHASE = pad("0x02");
const TX = pad("0xabc1") as `0x${string}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function depositLog(logIndex: number) {
  const topics = encodeEventTopics({
    abi: HEDGED_ESCROW_ABI,
    eventName: "DepositEvent",
    args: { promo: PROMO, purchase: PURCHASE, customer: ALICE },
  });
  const data = encodeAbiParameters(
    [{ type: "bytes16" }, { type: "uint64" }, { type: "uint64" }],
    ["0x0123456789abcdef0123456789abcdef", 5_000_000n, 1_000n],
  );
  return {
    address: ESC,
    topics,
    data,
    logIndex,
    transactionHash: TX,
    blockNumber: "0x10",
    removed: false,
  };
}
const transferLog = (from: string, to: string, v: bigint, address: string = TOKEN) => ({
  address,
  topics: [TRANSFER, pad(from as `0x${string}`), pad(to as `0x${string}`)],
  data: pad(`0x${v.toString(16)}`),
  transactionHash: TX,
  blockNumber: "0x10",
  logIndex: 0,
});

test("decodes a DepositEvent with eventIndex among escrow events", () => {
  const evs = decodeEscrowLogs(
    [transferLog(ALICE, ESC, 5_000_000n) as never, depositLog(1) as never],
    ESC,
  );
  assert.equal(evs.length, 1);
  const e = evs[0]!;
  assert.equal(e.name, "DepositEvent");
  assert.equal(e.eventIndex, 0);
  assert.equal(e.logIndex, 1);
  if (e.name === "DepositEvent") {
    assert.equal(e.amount, "5000000");
    assert.equal(e.purchaseId, "0123456789abcdef0123456789abcdef");
    assert.equal(e.customer, ALICE);
  }
});

test("token conservation: deposit needs a matching transfer into the escrow", () => {
  const evs = decodeEscrowLogs([depositLog(1) as never], ESC);
  const ok = tokenMoves({ logs: [transferLog(ALICE, ESC, 5_000_000n)] as never }, TOKEN);
  assert.equal(checkTokenConservation(evs, ok, ESC), null);
  const wrong = tokenMoves({ logs: [transferLog(ALICE, ESC, 4_000_000n)] as never }, TOKEN);
  assert.match(checkTokenConservation(evs, wrong, ESC) ?? "", /no token transfer/);
  // Arc's 18-decimal system-emitter log is ignored; only the 6-decimal token interface counts
  const sys = tokenMoves(
    {
      logs: [
        transferLog(
          ALICE,
          ESC,
          5_000_000n * 10n ** 12n,
          "0xfffffffffffffffffffffffffffffffffffffffe",
        ),
      ] as never,
    },
    TOKEN,
  );
  assert.equal(sys.length, 0);
  const extra = tokenMoves(
    { logs: [transferLog(ALICE, ESC, 5_000_000n), transferLog(ESC, ALICE, 1n)] as never },
    TOKEN,
  );
  assert.match(checkTokenConservation(evs, extra, ESC) ?? "", /net token change/);
});

test("filter keeps only escrow txs from the logs dataset and returns null otherwise", () => {
  const block = [
    [[transferLog(ALICE, ESC, 5_000_000n), depositLog(1)], [transferLog(ALICE, ALICE, 1n)]],
  ];
  const out = runArcStreamsFilterLocally(ESC, { data: block }) as {
    matchedTransactions: { txHash: string; blockNumber: number; events: string[] }[];
  };
  assert.equal(out.matchedTransactions.length, 1);
  assert.equal(out.matchedTransactions[0]!.txHash, TX);
  assert.equal(out.matchedTransactions[0]!.blockNumber, 16);
  assert.deepEqual(out.matchedTransactions[0]!.events, ["DepositEvent"]);
  assert.equal(
    runArcStreamsFilterLocally(ESC, { data: [[[transferLog(ALICE, ALICE, 1n)]]] }),
    null,
  );
  const other = getAddress("0x1111111111111111111111111111111111111111");
  assert.equal(runArcStreamsFilterLocally(other, { data: block }), null);
});

test("webhook: HMAC over the uncompressed body, gzip, freshness, parsing", () => {
  const token = "s3cret";
  const body = JSON.stringify({
    matchedTransactions: [{ txHash: TX, blockNumber: 16, events: ["DepositEvent"] }],
  });
  const nonce = "n1";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = computeStreamsSignature(token, nonce, ts, body);
  const got: string[] = [];
  const ok = handleArcStreamsWebhook(
    {
      headers: {
        "x-qn-nonce": nonce,
        "x-qn-timestamp": ts,
        "x-qn-signature": sig,
        "content-encoding": "gzip",
      },
      rawBody: gzipSync(body),
    },
    { securityToken: token, onSignals: (s) => got.push(...s.map((x) => x.txHash)) },
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(got, [TX]);
  const bad = handleArcStreamsWebhook(
    {
      headers: {
        "x-qn-nonce": nonce,
        "x-qn-timestamp": ts,
        "x-qn-signature": sig.replace(/.$/, "0"),
      },
      rawBody: body,
    },
    { securityToken: token, onSignals: () => assert.fail("must not deliver") },
  );
  assert.equal(bad.status, 401);
  assert.equal(timestampFresh(String(Math.floor(Date.now() / 1000) - 3600)), false);
  assert.equal(timestampFresh(String(Date.now())), true);
});

test("raw logs dataset (no filter) is parsed defensively and scoped to the escrow", () => {
  const raw = { data: [[[depositLog(1), transferLog(ALICE, ESC, 1n)]]] };
  assert.deepEqual(
    parseArcStreamsPayload(raw, ESC).map((s) => s.txHash),
    [TX],
  );
  assert.deepEqual(parseArcStreamsPayload(raw, "0x1111111111111111111111111111111111111111"), []);
});
