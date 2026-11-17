import type { Base58, PurchaseIdHex } from "@hedged/shared";
import { NotImplementedError } from "./errors";

/**
 * PDA derivation. Seed conventions are FINAL — see `PDA_SEEDS` in @hedged/shared and
 * docs/interfaces.md. TODO(Dev 3): implement with @solana/web3.js `PublicKey.findProgramAddressSync`.
 */
export interface PdaResult {
  address: Base58;
  bump: number;
}

/** ["config"] */
export function deriveConfigPda(_programId: Base58): PdaResult {
  throw new NotImplementedError("deriveConfigPda");
}

/** ["promo", merchant, promoNonce u64 LE] */
export function derivePromoPda(_args: {
  programId: Base58;
  merchant: Base58;
  promoNonce: bigint;
}): PdaResult {
  throw new NotImplementedError("derivePromoPda");
}

/** ["purchase", promo, customer, purchaseId (16 bytes)] */
export function derivePurchasePda(_args: {
  programId: Base58;
  promo: Base58;
  customer: Base58;
  purchaseId: PurchaseIdHex;
}): PdaResult {
  throw new NotImplementedError("derivePurchasePda");
}

/** Promotion vault = ATA(owner = promo PDA, mint), allowOwnerOffCurve. The promo PDA is the authority. */
export function deriveVaultAddress(_args: { promo: Base58; mint: Base58 }): Base58 {
  throw new NotImplementedError("deriveVaultAddress");
}
