import type { Base58, TokenBaseUnits } from "./money";

/**
 * Decoded Anchor `DepositEvent` plus the chain position needed for dedupe/replay.
 * Event fields mirror CLAUDE.md §6: { purchase, promo, customer, amount }.
 * Emitted by the program; independently verified by packages/solana before use.
 */
export interface DepositEvent {
  purchase: Base58;
  promo: Base58;
  customer: Base58;
  amount: TokenBaseUnits;

  // Chain position (not part of the on-chain event payload)
  signature: Base58;
  /** Index of the event within the transaction's logs. */
  eventIndex: number;
  slot: number;
  /** Unix seconds; may be null if the RPC omits it. */
  blockTime: number | null;
  commitment: "confirmed" | "finalized";
}

/** Dedupe key: (transaction signature, event index). */
export const depositEventId = (e: Pick<DepositEvent, "signature" | "eventIndex">): string =>
  `${e.signature}:${e.eventIndex}`;
