import type { Base58, IsoTimestamp, PriceMicroUsd, TokenBaseUnits } from "./money";
import type { OnChainPromoState } from "./status";

/** Preliminary. Combines on-chain Promo fields with off-chain merchant configuration. */
export interface Promotion {
  /** Database id (uuid). */
  id: string;

  // ---- ON-CHAIN (authoritative) ----
  onChain: {
    promoPda: Base58 | null; // null until initialize_promo is confirmed
    merchant: Base58;
    relayer: Base58;
    mint: Base58;
    /** Price/refund amount per purchase, base units (demo: "5000000"). */
    offerAmount: TokenBaseUnits;
    /** Unix seconds; deposits rejected after this. */
    depositDeadline: number;
    state: OnChainPromoState;
  };

  // ---- OFF-CHAIN (Dev 3 / merchant config) ----
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
