/**
 * Two SEPARATE state spaces — do not conflate them.
 *
 * 1. On-chain escrow state: authoritative for funds (Anchor Promo / Purchase accounts).
 * 2. Off-chain orchestration state: derived operational record in Supabase.
 *
 * `REFUNDED` must not be set off-chain until the on-chain refund is verified.
 */

/** ON-CHAIN: Promo lifecycle. Pause is global (Config.paused), not a promo state. */
export type OnChainPromoState = "Active" | "ResolvedYes" | "ResolvedNo";

/**
 * ON-CHAIN: Purchase escrow lifecycle (mirrors the Anchor `PurchaseState` enum).
 * Terminal: Refunded, ClaimedByCustomer, ClaimedByMerchant.
 */
export type OnChainPurchaseState =
  "Deposited" | "Hedged" | "Cancelled" | "Refunded" | "ClaimedByCustomer" | "ClaimedByMerchant";

/**
 * OFF-CHAIN: database orchestration status for a purchase (Dev 4). Transition table and mapping to
 * on-chain states: docs/workflow.md. Only HEDGED/CANCELLED/REFUNDED/CLAIMED are set from confirmed
 * on-chain facts; the rest are processing states.
 */
export const PURCHASE_STATUSES = [
  "DEPOSITED", // verified deposit recorded; on-chain Deposited
  "PENDING_HEDGE", // worker claimed it; fetching quote / simulating
  "HEDGE_SIMULATED", // simulated hedge persisted; mark_hedged not yet confirmed
  "HEDGED", // mark_hedged confirmed; on-chain Hedged (merchant may fulfill)
  "HEDGE_FAILED", // simulation failed (or gave up); cancellation not yet requested
  "CANCEL_PENDING", // cancel_unhedged requested, not yet confirmed
  "CANCELLED", // cancel_unhedged confirmed; on-chain Cancelled; awaiting customer claim_refund
  "REFUNDED", // claim_refund (cancel path) confirmed; on-chain Refunded
  "RESOLVED", // promo resolved on-chain; hedged purchase's entitlement is claimable
  "CLAIMED", // YES refund or merchant payout confirmed; on-chain Claimed*
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** OFF-CHAIN: status of a SIMULATED hedge. Never implies a real Gemini order. */
export const HEDGE_STATUSES = [
  "PENDING",
  "SIMULATED_FILLED",
  "SIMULATED_PARTIAL",
  "FAILED",
  "VOIDED", // simulated fill released because the purchase was cancelled on-chain
  "SETTLED_WIN",
  "SETTLED_LOSS",
] as const;
export type HedgeStatus = (typeof HEDGE_STATUSES)[number];

/** Why a simulated hedge failed (extend as Dev 4 refines policy). */
export type HedgeFailureReason =
  | "QUOTE_OVER_CAP"
  | "QUOTE_STALE"
  | "QUOTE_UNAVAILABLE"
  | "INSUFFICIENT_LIQUIDITY"
  | "PARTIAL_FILL"
  | "BUDGET_EXCEEDED"
  | "MARK_HEDGED_FAILED"; // on-chain mark_hedged could not be confirmed within policy / purchase cancelled
