import { PDA_SEEDS, PURCHASE_ID_BYTES, type Base58, type PurchaseIdHex } from "@hedged/shared";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

/**
 * PDA derivation. Seed conventions are FINAL — see `PDA_SEEDS` in @hedged/shared and
 * docs/interfaces.md §1. Verified against the program's IDL seeds in pda.test.ts.
 */
export interface PdaResult {
  address: Base58;
  bump: number;
}

const enc = new TextEncoder();
const pk = (v: Base58 | PublicKey) => (typeof v === "string" ? new PublicKey(v) : v);

/** u64 little-endian, 8 bytes. */
export function u64le(value: bigint | number | string): Uint8Array {
  const v = BigInt(value);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new RangeError(`u64 out of range: ${v}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

const HEX32 = /^[0-9a-f]{32}$/;

/** 32 lowercase hex chars -> 16 bytes (throws on anything else). */
export function purchaseIdToBytes(id: PurchaseIdHex): Uint8Array {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!HEX32.test(hex)) {
    throw new Error(`purchaseId must be ${PURCHASE_ID_BYTES} bytes as 32 hex chars (got "${id}")`);
  }
  const out = new Uint8Array(PURCHASE_ID_BYTES);
  for (let i = 0; i < PURCHASE_ID_BYTES; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToPurchaseId(bytes: ArrayLike<number>): PurchaseIdHex {
  if (bytes.length !== PURCHASE_ID_BYTES) throw new Error("purchase_id must be 16 bytes");
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh random purchase id (UUIDv4 bytes, as 32 lowercase hex chars). Browser and Node. */
export function newPurchaseId(): PurchaseIdHex {
  const uuid = globalThis.crypto.randomUUID();
  return uuid.replace(/-/g, "");
}

function find(seeds: Uint8Array[], programId: Base58 | PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, pk(programId));
}

/** ["config"] */
export function deriveConfigPda(programId: Base58): PdaResult {
  const [a, bump] = find([enc.encode(PDA_SEEDS.config)], programId);
  return { address: a.toBase58(), bump };
}

/** ["promo", merchant, promoNonce u64 LE] */
export function derivePromoPda(args: {
  programId: Base58;
  merchant: Base58;
  promoNonce: bigint;
}): PdaResult {
  const [a, bump] = find(
    [enc.encode(PDA_SEEDS.promo), pk(args.merchant).toBytes(), u64le(args.promoNonce)],
    args.programId,
  );
  return { address: a.toBase58(), bump };
}

/** ["purchase", promo, customer, purchaseId (16 bytes)] */
export function derivePurchasePda(args: {
  programId: Base58;
  promo: Base58;
  customer: Base58;
  purchaseId: PurchaseIdHex;
}): PdaResult {
  const [a, bump] = find(
    [
      enc.encode(PDA_SEEDS.purchase),
      pk(args.promo).toBytes(),
      pk(args.customer).toBytes(),
      purchaseIdToBytes(args.purchaseId),
    ],
    args.programId,
  );
  return { address: a.toBase58(), bump };
}

/** Promotion vault = ATA(owner = promo PDA, mint), allowOwnerOffCurve. The promo PDA is the authority. */
export function deriveVaultAddress(args: { promo: Base58; mint: Base58 }): Base58 {
  return getAssociatedTokenAddressSync(pk(args.mint), pk(args.promo), true).toBase58();
}

/** The wallet's ATA for the mock mint (claim destinations and deposit source default to it). */
export function deriveTokenAccount(args: { owner: Base58; mint: Base58 }): Base58 {
  return getAssociatedTokenAddressSync(pk(args.mint), pk(args.owner), false).toBase58();
}
