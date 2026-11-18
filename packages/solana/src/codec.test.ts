import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import fixtures from "./__fixtures__/escrow-logs.json";
import {
  canTimeoutCancel,
  decodeEventsFromLogs,
  enumVariant,
  extractProgramErrorCode,
} from "./index";

type Fixture = {
  logs: string[];
  decoded: { eventIndex: number; event: Record<string, unknown> }[];
};
const fx = fixtures as unknown as Record<string, Fixture>;

test("decodes every event kind from real escrow logs (captured on a local validator)", () => {
  for (const [key, f] of Object.entries(fx)) {
    const got = decodeEventsFromLogs(f.logs);
    assert.deepEqual(got, f.decoded, key);
    assert.equal(got.length, 1, `${key}: each instruction emits exactly one event`);
    assert.equal(got[0]!.eventIndex, 0);
  }
});

test("DepositEvent fields are mapped to the shared shape", () => {
  const e = decodeEventsFromLogs(fx.DepositEvent!.logs)[0]!.event;
  assert.equal(e.name, "DepositEvent");
  if (e.name !== "DepositEvent") return;
  assert.equal(e.amount, "5000000");
  assert.match(e.purchaseId, /^[0-9a-f]{32}$/);
  assert.equal(typeof e.depositedAt, "number");
});

test("enum variants map to the shared unions", () => {
  assert.equal(
    (decodeEventsFromLogs(fx["ResolutionEvent:YES"]!.logs)[0]!.event as { outcome: string })
      .outcome,
    "YES",
  );
  assert.equal(
    (decodeEventsFromLogs(fx["ResolutionEvent:NO"]!.logs)[0]!.event as { outcome: string }).outcome,
    "NO",
  );
  assert.equal(
    (decodeEventsFromLogs(fx["ClaimEvent:MERCHANT_PAYOUT"]!.logs)[0]!.event as { kind: string })
      .kind,
    "MERCHANT_PAYOUT",
  );
  assert.equal(enumVariant({ cancelRefund: {} }), "cancelRefund");
  assert.throws(() => enumVariant({ a: {}, b: {} }));
});

test("ignores other programs' logs and events emitted under another program id", () => {
  const other = new PublicKey("11111111111111111111111111111112");
  assert.deepEqual(decodeEventsFromLogs(fx.DepositEvent!.logs, other), []);
  assert.deepEqual(decodeEventsFromLogs([]), []);
});

test("two escrow instructions in one tx -> eventIndex 0 and 1", () => {
  const a = fx.DepositEvent!.logs;
  const b = fx.HedgeMarkedEvent!.logs;
  const got = decodeEventsFromLogs([...a, ...b]);
  assert.deepEqual(
    got.map((g) => [g.eventIndex, g.event.name]),
    [
      [0, "DepositEvent"],
      [1, "HedgeMarkedEvent"],
    ],
  );
});

test("program error codes are extracted from every shape web3.js/Anchor produce", () => {
  assert.equal(extractProgramErrorCode({ InstructionError: [0, { Custom: 6009 }] }), 6009);
  assert.equal(extractProgramErrorCode(new Error("failed: custom program error: 0x177c")), 6012);
  assert.equal(
    extractProgramErrorCode(null, [
      "Program log: AnchorError occurred. Error Code: ResolutionTooEarly. Error Number: 6020.",
    ]),
    6020,
  );
  assert.equal(extractProgramErrorCode({ transactionLogs: ["... Error Number: 3012. ..."] }), 3012);
  assert.equal(extractProgramErrorCode(new Error("fetch failed")), null);
});

test("canTimeoutCancel uses the inclusive bound and only Deposited purchases", () => {
  const promo = { cancelTimeoutSecs: 600 };
  assert.equal(canTimeoutCancel({ state: "Deposited", depositedAt: 1000 }, promo, 1599), false);
  assert.equal(canTimeoutCancel({ state: "Deposited", depositedAt: 1000 }, promo, 1600), true);
  assert.equal(canTimeoutCancel({ state: "Hedged", depositedAt: 1000 }, promo, 99999), false);
});
