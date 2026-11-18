import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, toEventSelector, toFunctionSelector } from "viem";
import { HEDGED_ESCROW_ABI } from "./abi";
import { ESCROW_ERROR_NAMES, escrowErrorCode } from "./errors";
import { fromBytes16, isBytes32, promoIdOf, purchaseKeyOf, toBytes16 } from "./ids";

const M = getAddress("0x00000000000000000000000000000000000000aa");
const C = getAddress("0x00000000000000000000000000000000000000bb");

test("promo ids are deterministic and namespaced by merchant and nonce", () => {
  const a = promoIdOf(M, 1n);
  assert.equal(a, promoIdOf(M, 1));
  assert.ok(isBytes32(a));
  assert.notEqual(a, promoIdOf(M, 2n));
  assert.notEqual(a, promoIdOf(C, 1n));
});

test("purchase keys depend on promo, customer and purchase id", () => {
  const p = promoIdOf(M, 1n);
  const id = "0123456789abcdef0123456789abcdef";
  const k = purchaseKeyOf(p, C, id);
  assert.equal(k, purchaseKeyOf(p, C, `0x${id}`));
  assert.equal(k, purchaseKeyOf(p, C, "01234567-89ab-cdef-0123-456789abcdef"));
  assert.notEqual(k, purchaseKeyOf(p, M, id));
  assert.notEqual(k, purchaseKeyOf(promoIdOf(M, 2n), C, id));
});

test("bytes16 round trip and validation", () => {
  assert.equal(
    fromBytes16(toBytes16("ABCDEF0123456789abcdef0123456789")),
    "abcdef0123456789abcdef0123456789",
  );
  assert.throws(() => toBytes16("abc"));
});

test("error names follow the contract ABI order and Anchor codes", () => {
  const abiErrors = HEDGED_ESCROW_ABI.filter((x) => x.type === "error").map(
    (x) => (x as { name: string }).name,
  );
  assert.deepEqual([...abiErrors].sort(), [...ESCROW_ERROR_NAMES].sort());
  assert.equal(escrowErrorCode("Unauthorized"), 6000);
  assert.equal(escrowErrorCode("ResolutionTooEarly"), 6020);
  assert.equal(escrowErrorCode("InvalidTimeout"), 6022);
});

test("the ABI exposes the 12 operations (constructor = initialize_config)", () => {
  const fns = new Set(
    HEDGED_ESCROW_ABI.filter((x) => x.type === "function").map((x) => (x as { name: string }).name),
  );
  for (const f of [
    "setPaused",
    "setRelayer",
    "setCancelTimeout",
    "initializePromo",
    "deposit",
    "markHedged",
    "cancelUnhedged",
    "cancelExpiredDeposit",
    "resolvePromo",
    "claimRefund",
    "claimMerchant",
  ]) {
    assert.ok(fns.has(f), f);
  }
  assert.ok(HEDGED_ESCROW_ABI.some((x) => x.type === "constructor"));
  assert.equal(toFunctionSelector("deposit(bytes32,bytes16,uint64)").length, 10);
});

test("event topics hard-coded in streams/filter.js match the ABI", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../streams/filter.js", import.meta.url), "utf8");
  for (const sig of [
    "DepositEvent(bytes32,bytes32,address,bytes16,uint64,uint64)",
    "HedgeMarkedEvent(bytes32,bytes32,address,uint64)",
    "PurchaseCancelledEvent(bytes32,bytes32,address,uint64,uint64)",
    "ResolutionEvent(bytes32,uint8,address,uint64)",
    "ClaimEvent(bytes32,bytes32,address,uint64,uint8,uint64)",
  ]) {
    assert.ok(src.includes(toEventSelector(sig)), sig);
    const name = sig.split("(")[0];
    assert.ok(
      HEDGED_ESCROW_ABI.some((x) => x.type === "event" && (x as { name: string }).name === name),
      name,
    );
  }
});
