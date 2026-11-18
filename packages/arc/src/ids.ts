import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * Deterministic ids replacing the Anchor PDAs (same inputs, same role):
 *   Promo    ["promo", merchant, promo_nonce]                -> promoId     = keccak256(abi.encode("promo", merchant, nonce))
 *   Purchase ["purchase", promo, customer, purchase_id[16]] -> purchaseKey = keccak256(abi.encode("purchase", promoId, customer, purchaseId))
 * Both are bytes32 hex strings; they stand where the gateway interface says `promoPda` /
 * `purchasePda` (typed `Base58` in @hedged/shared, which is just `string`).
 */
export function promoIdOf(merchant: Address, promoNonce: bigint | number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }, { type: "uint64" }],
      ["promo", merchant, BigInt(promoNonce)],
    ),
  );
}

export function purchaseKeyOf(promoId: Hex, customer: Address, purchaseIdHex: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "bytes16" }],
      ["purchase", promoId, customer, toBytes16(purchaseIdHex)],
    ),
  );
}

/** `PurchaseIdHex` (32 hex chars, as in @hedged/shared) -> bytes16 hex. Accepts a UUID with dashes. */
export function toBytes16(purchaseIdHex: string): Hex {
  const h = purchaseIdHex.replace(/^0x/, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h))
    throw new Error(`purchaseId must be 16 bytes hex, got "${purchaseIdHex}"`);
  return `0x${h}`;
}

/** bytes16 hex -> `PurchaseIdHex` (32 lowercase hex chars, no 0x). */
export function fromBytes16(b: Hex): string {
  return b.replace(/^0x/, "").toLowerCase().padStart(32, "0");
}

export function isBytes32(v: string): v is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** Random client-side purchase id (UUIDv4 bytes), like the Solana SDK. */
export function newPurchaseIdHex(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
