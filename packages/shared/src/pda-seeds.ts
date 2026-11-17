/**
 * Deterministic PDA seed conventions — single source of truth for TS. MUST match
 * programs/escrow/src/state/mod.rs. Derivation helpers live in @hedged/solana (Dev 3).
 *
 *   config   = PDA(["config"])
 *   promo    = PDA(["promo", merchant(32), promoNonce(u64 LE, 8)])
 *   purchase = PDA(["purchase", promo(32), customer(32), purchaseId(16)])
 *   vaultAuthority = the promo PDA itself (no separate authority account)
 *   vault    = ATA(owner = promo PDA, mint = config.mint), allowOwnerOffCurve = true
 */
export const PDA_SEEDS = {
  config: "config",
  promo: "promo",
  purchase: "purchase",
} as const;

/** Purchase ids are 16 random bytes (UUIDv4), carried in TS as 32 lowercase hex chars. */
export const PURCHASE_ID_BYTES = 16;
export type PurchaseIdHex = string;
export const MAX_MARKET_ID_LEN = 64;
