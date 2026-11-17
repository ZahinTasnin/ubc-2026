import type { Base58, IsoTimestamp, TokenBaseUnits } from "./money";
import type { OnChainPurchaseState, PurchaseStatus } from "./status";
import type { PurchaseIdHex } from "./pda-seeds";

/** Preliminary. Escrow facts (on-chain) are kept apart from orchestration (off-chain). */
export interface Purchase {
  /** Database id (uuid). */
  id: string;
  promotionId: string;

  // ---- ON-CHAIN (authoritative for funds) ----
  onChain: {
    purchasePda: Base58;
    /** 16-byte purchase id (32 hex chars) used in the purchase PDA seeds. */
    purchaseId: PurchaseIdHex;
    customer: Base58;
    amount: TokenBaseUnits;
    state: OnChainPurchaseState;
    depositTxSignature: Base58;
    /** Unique deposit event id: `${signature}:${eventIndex}`. */
    depositEventId: string;
  };

  // ---- OFF-CHAIN (derived operational record) ----
  status: PurchaseStatus;
  hedgeId: string | null;
  depositedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
