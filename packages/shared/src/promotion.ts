import type { Base58, IsoTimestamp, PriceMicroUsd, TokenBaseUnits } from "./money";
import type { OnChainPromoState } from "./status";

/** Preliminary. Combines on-chain Promo fields with off-chain merchant configuration. */
export interface Promotion {
  /** Database id (uuid). */
  id: string;

  // ---- ON-CHAIN (authoritative) ----
  onChain: {
    promoPda: Base58 | null; // null until initialize_promo is confirmed
    /** Promo PDA seed nonce (u64 as decimal string); see pda-seeds.ts. */
    promoNonce: string;
    merchant: Base58;
    mint: Base58;
    /** Promotion-level vault: ATA(promo PDA, mint). */
    vault: Base58 | null;
    /** Price/refund amount per purchase, base units (demo: "5000000"). */
    offerAmount: TokenBaseUnits;
    /** Unix seconds; deposits rejected after this. */
    depositDeadline: number;
    state: OnChainPromoState;
  };

  // ---- OFF-CHAIN (Dev 4 / merchant config) ----
  /** Exact Gemini market identifier used for quotes AND final settlement. */
  geminiMarketId: string;
  /** Human label, e.g. "Texas wins". */
  outcomeLabel: string;
  /** Merchant's max acceptable YES price per contract (micro-USD). */
  maxYesPriceMicroUsd: PriceMicroUsd;
  /** Max total simulated premium budget (base units). */
  hedgeBudget: TokenBaseUnits;
  createdAt: IsoTimestamp;
}
