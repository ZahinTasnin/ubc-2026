import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  ESCROW_IDL,
  ESCROW_PROGRAM_ID,
  bytesToPurchaseId,
  deriveConfigPda,
  derivePromoPda,
  derivePurchasePda,
  deriveVaultAddress,
  newPurchaseId,
  purchaseIdToBytes,
  u64le,
} from "./index";

const PID = ESCROW_PROGRAM_ID.toBase58();

test("program id comes from the committed IDL", () => {
  assert.equal(PID, "E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr");
  assert.equal(ESCROW_IDL.address, PID);
});

test("config PDA matches the live Devnet Config account", () => {
  // Read from Devnet 2026-11-17 (scripts/devnet-read.ts).
  assert.equal(deriveConfigPda(PID).address, "B1CZWbo77HNKsMKohK2Htw6WyqMEj9JQvSFFUwf5PTEk");
});

test("seed constants agree with the IDL's PDA definitions", () => {
  // deposit's `purchase` and initialize_promo's `promo` declare their seeds in the IDL.
  const ix = (n: string) =>
    (
      ESCROW_IDL.instructions as unknown as {
        name: string;
        accounts: {
          name: string;
          pda?: { seeds: { kind: string; value?: number[]; path?: string }[] };
        }[];
      }[]
    ).find((i) => i.name === n)!;
  const seeds = (n: string, acc: string) => ix(n).accounts.find((a) => a.name === acc)!.pda!.seeds;
  const text = (s: { value?: number[] }) => Buffer.from(s.value ?? []).toString();
  assert.equal(text(seeds("initialize_config", "config")[0]!), "config");
  const promo = seeds("initialize_promo", "promo");
  assert.equal(text(promo[0]!), "promo");
  assert.deepEqual(
    promo.slice(1).map((s) => s.kind),
    ["account", "arg"],
  );
  const purchase = seeds("deposit", "purchase");
  assert.equal(text(purchase[0]!), "purchase");
  assert.deepEqual(
    purchase.slice(1).map((s) => s.kind),
    ["account", "account", "arg"],
  );
});

test("u64le is 8 bytes little-endian and range-checked", () => {
  assert.deepEqual([...u64le(1n)], [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...u64le(258)], [2, 1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...u64le("18446744073709551615")], [255, 255, 255, 255, 255, 255, 255, 255]);
  assert.throws(() => u64le(-1n));
  assert.throws(() => u64le(2n ** 64n));
});

test("purchase ids: 16 bytes <-> 32 hex, UUID dashes accepted, junk rejected", () => {
  const id = newPurchaseId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(bytesToPurchaseId(purchaseIdToBytes(id)), id);
  assert.equal(
    bytesToPurchaseId(purchaseIdToBytes("0123abcd-0123-4abc-8def-0123456789ab")),
    "0123abcd01234abc8def0123456789ab",
  );
  assert.throws(() => purchaseIdToBytes("xyz"));
  assert.throws(() => purchaseIdToBytes("00".repeat(17)));
});

test("promo/purchase PDAs are deterministic and match a manual derivation", () => {
  const merchant = "CDUCzXkRqGSS8WbG787JBmgmCzHPn6hacpLhLX5xx18J";
  const promo = derivePromoPda({ programId: PID, merchant, promoNonce: 42n });
  const [manual] = PublicKey.findProgramAddressSync(
    [Buffer.from("promo"), new PublicKey(merchant).toBuffer(), Buffer.from(u64le(42n))],
    ESCROW_PROGRAM_ID,
  );
  assert.equal(promo.address, manual.toBase58());
  assert.notEqual(
    derivePromoPda({ programId: PID, merchant, promoNonce: 43n }).address,
    promo.address,
  );

  const purchaseId = "00112233445566778899aabbccddeeff";
  const p = derivePurchasePda({
    programId: PID,
    promo: promo.address,
    customer: merchant,
    purchaseId,
  });
  const [manualP] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("purchase"),
      new PublicKey(promo.address).toBuffer(),
      new PublicKey(merchant).toBuffer(),
      Buffer.from(purchaseId, "hex"),
    ],
    ESCROW_PROGRAM_ID,
  );
  assert.equal(p.address, manualP.toBase58());
});

test("vault is the promo PDA's ATA (off-curve owner allowed)", () => {
  const promo = derivePromoPda({ programId: PID, merchant: PID, promoNonce: 1n }).address;
  const vault = deriveVaultAddress({ promo, mint: "9jEseJnxWcKF8ntiDKiG6qk448rZQuGRJdR7Kj2ByWhY" });
  assert.ok(PublicKey.isOnCurve(new PublicKey(promo).toBytes()) === false);
  assert.match(vault, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});
