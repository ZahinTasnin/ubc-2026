import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection } from "@solana/web3.js";
import fixtures from "../__fixtures__/escrow-logs.json";
import { ESCROW_PROGRAM_ID } from "../idl";
import { verifySignature } from "./verify";

const fx = fixtures as unknown as Record<string, { logs: string[] }>;

/** Minimal Connection stub: a "successful" tx whose logs claim a deposit that never happened. */
function forgedConnection(opts: { err?: unknown } = {}): Connection {
  const keys = [ESCROW_PROGRAM_ID];
  return {
    getTransaction: async () => ({
      slot: 99,
      blockTime: 1,
      meta: {
        err: opts.err ?? null,
        logMessages: fx.DepositEvent!.logs,
        preTokenBalances: [],
        postTokenBalances: [],
      },
      transaction: {
        message: { getAccountKeys: () => ({ length: keys.length, get: (i: number) => keys[i] }) },
      },
    }),
    getSignatureStatuses: async () => ({
      value: [{ confirmationStatus: "finalized", slot: 99, err: null }],
    }),
    getAccountInfo: async () => null,
    getTokenAccountBalance: async () => ({ value: { amount: "0" } }),
  } as unknown as Connection;
}

test("events are not proof: a DepositEvent without the account/token effects is rejected", async () => {
  const r = await verifySignature(
    {
      connection: forgedConnection(),
      programId: ESCROW_PROGRAM_ID,
      mint: "9jEseJnxWcKF8ntiDKiG6qk448rZQuGRJdR7Kj2ByWhY",
    },
    "sig",
    "finalized",
  );
  assert.equal(r.verification.confirmed, true);
  assert.deepEqual(r.verification.events, []);
  assert.ok(
    r.failures.some((f) => f.includes("purchase account missing")),
    r.failures.join(),
  );
});

test("a failed transaction yields no events and carries its error", async () => {
  const r = await verifySignature(
    {
      connection: forgedConnection({ err: { InstructionError: [0, { Custom: 6006 }] } }),
      programId: ESCROW_PROGRAM_ID,
      mint: "x",
    },
    "sig",
    "finalized",
  );
  assert.equal(r.verification.confirmed, false);
  assert.match(r.verification.err ?? "", /6006/);
  assert.deepEqual(r.verification.events, []);
});
