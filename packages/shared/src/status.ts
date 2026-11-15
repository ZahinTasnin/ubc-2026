/**
 * Two SEPARATE state spaces — do not conflate them.
 *
 * 1. On-chain escrow state: authoritative for funds (Anchor Promo / Purchase accounts).
 * 2. Off-chain orchestration state: derived operational record in Supabase.
 *
 * `REFUNDED` must not be set off-chain until the on-chain refund is verified.
 */

/** ON-CHAIN: Promo account lifecycle (preliminary mirror of the Anchor enum). */
export type OnChainPromoState = "Active" | "Paused" | "ResolvedYes" | "ResolvedNo";

/** ON-CHAIN: Purchase account escrow lifecycle (preliminary mirror of the Anchor enum). */
export type OnChainPurchaseState =
  "Deposited" | "Hedged" | "Cancelled" | "ClaimedByCustomer" | "ClaimedByMerchant";

/** OFF-CHAIN: database orchestration status for a purchase. */
export const PURCHASE_STATUSES = [
  "DEPOSITED",
  "PENDING_HEDGE",
  "HEDGED",
  "HEDGE_FAILED",
  "CANCEL_PENDING",
  "REFUNDED",
  "RESOLVED",
  "CLAIMED",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** OFF-CHAIN: status of a SIMULATED hedge. Never implies a real Gemini order. */
export const HEDGE_STATUSES = [
  "PENDING",
  "SIMULATED_FILLED",
  "SIMULATED_PARTIAL",
  "FAILED",
  "SETTLED_WIN",
  "SETTLED_LOSS",
] as const;
export type HedgeStatus = (typeof HEDGE_STATUSES)[number];

/** Why a simulated hedge failed (extend as Dev 3 refines policy). */
export type HedgeFailureReason =
  | "QUOTE_OVER_CAP"
  | "QUOTE_STALE"
  | "QUOTE_UNAVAILABLE"
  | "INSUFFICIENT_LIQUIDITY"
  | "PARTIAL_FILL"
  | "BUDGET_EXCEEDED";
