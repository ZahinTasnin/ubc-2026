import type { Base58, TokenBaseUnits } from "./money";
import type { PurchaseIdHex } from "./pda-seeds";

/**
 * TS mirrors of the Anchor events (programs/escrow/src/events.rs) after the off-chain listener has
 * decoded AND VERIFIED them (finalized tx succeeded, program ID, accounts, mint, amounts, and
 * account/token state agree). Events are notifications, not proof: never construct these from an
 * unverified log. u64 -> decimal string; i64 -> number (unix seconds).
 */

/** Attached off-chain by the listener; NOT part of the Anchor payload. */
export interface ChainPosition {
  signature: Base58;
  /** 0-based index of the event among the program's decoded events in this transaction. */
  eventIndex: number;
  slot: number;
  /** Unix seconds; null if the RPC omits it. */
  blockTime: number | null;
  /** Verified events are delivered at the configured commitment (MVP default: "finalized"). */
  commitment: "confirmed" | "finalized";
}

/** Emitted by `deposit`. */
export interface DepositEvent extends ChainPosition {
  promo: Base58;
  purchase: Base58;
  customer: Base58;
  purchaseId: PurchaseIdHex;
  amount: TokenBaseUnits;
  depositedAt: number;
}

/** Emitted by `mark_hedged`. */
export interface HedgeMarkedEvent extends ChainPosition {
  promo: Base58;
  purchase: Base58;
  relayer: Base58;
  markedAt: number;
}

/** Emitted by `cancel_unhedged`. */
export interface PurchaseCancelledEvent extends ChainPosition {
  promo: Base58;
  purchase: Base58;
  customer: Base58;
  amount: TokenBaseUnits;
  cancelledAt: number;
}

/** Emitted by `resolve_promo`. */
export interface ResolutionEvent extends ChainPosition {
  promo: Base58;
  outcome: "YES" | "NO";
  relayer: Base58;
  resolvedAt: number;
}

export type ClaimKind = "CANCEL_REFUND" | "YES_REFUND" | "MERCHANT_PAYOUT";

/** Emitted by `claim_refund` (CANCEL_REFUND | YES_REFUND) and `claim_merchant` (MERCHANT_PAYOUT). */
export interface ClaimEvent extends ChainPosition {
  promo: Base58;
  purchase: Base58;
  /** Owner of the destination token account. */
  recipient: Base58;
  amount: TokenBaseUnits;
  kind: ClaimKind;
  claimedAt: number;
}

export type ProgramEvent =
  | ({ name: "DepositEvent" } & DepositEvent)
  | ({ name: "HedgeMarkedEvent" } & HedgeMarkedEvent)
  | ({ name: "PurchaseCancelledEvent" } & PurchaseCancelledEvent)
  | ({ name: "ResolutionEvent" } & ResolutionEvent)
  | ({ name: "ClaimEvent" } & ClaimEvent);

/** Dedupe key for ANY verified event: (transaction signature, event index). */
export const chainEventId = (e: Pick<ChainPosition, "signature" | "eventIndex">): string =>
  `${e.signature}:${e.eventIndex}`;

/** @deprecated alias kept for existing imports; use `chainEventId`. */
export const depositEventId = chainEventId;
