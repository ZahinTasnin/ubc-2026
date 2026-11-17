import type { Base58, TokenBaseUnits } from "./money";
import type { OnChainPromoState, OnChainPurchaseState } from "./status";
import type { PurchaseIdHex } from "./pda-seeds";

/**
 * Decoded on-chain accounts as the gateway/SDK returns them (mirrors programs/escrow state).
 * u64 -> decimal string (TokenBaseUnits / counters); i64 timestamps -> number (unix seconds, 0 = unset).
 */
export interface OnChainConfig {
  admin: Base58;
  relayer: Base58;
  mint: Base58;
  paused: boolean;
}

export interface OnChainPromoAccount {
  promoPda: Base58;
  merchant: Base58;
  mint: Base58;
  vault: Base58;
  promoNonce: string;
  offerAmount: TokenBaseUnits;
  depositDeadline: number;
  marketId: string;
  state: OnChainPromoState;
  resolvedAt: number;
  totalDeposited: TokenBaseUnits;
  totalPaidOut: TokenBaseUnits;
  purchaseCount: string;
  /** totalDeposited - totalPaidOut. */
  outstanding: TokenBaseUnits;
  /** Live SPL balance of the vault (must be >= outstanding). */
  vaultBalance: TokenBaseUnits;
}

export interface OnChainPurchaseAccount {
  purchasePda: Base58;
  promoPda: Base58;
  customer: Base58;
  purchaseId: PurchaseIdHex;
  amount: TokenBaseUnits;
  state: OnChainPurchaseState;
  depositedAt: number;
  hedgedAt: number;
  cancelledAt: number;
  settledAt: number;
}
