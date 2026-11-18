import type { PriceMicroUsd, TokenBaseUnits } from "@hedged/shared";

/**
 * DEMO DATA: a fictional promotion for building and demoing the UI.
 *
 * - It was NOT created on-chain and NOT saved to any backend.
 * - It has no Solana addresses, no transaction signatures and no real Gemini market ID, because
 *   inventing those would make it look real. The shared `Promotion` type requires real on-chain
 *   identifiers, so this is a smaller frontend-only display type instead.
 * - Amounts are strings in mock USDC base units (6 decimals), like the rest of the app.
 *
 * Any UI that shows this record must label it as a demo.
 */
export interface DemoPromotion {
  /** Always true. Lets a UI check "is this demo data?" and show a Demo badge. */
  readonly isDemoData: true;
  /** Placeholder id for routes like /checkout/[promoId]. Not a database or on-chain id. */
  id: string;
  name: string;
  description: string;
  merchantName: string;
  /** Purchase price and refund amount, mock USDC base units. "5000000" = 5.00. */
  offerAmount: TokenBaseUnits;
  /** Merchant-provided label for the outcome that earns a refund. Not a verified market outcome. */
  refundCondition: string;
  /** Purchase eligibility deadline (ISO 8601, UTC). */
  expiresAt: string;
  /** Merchant's max acceptable modeled hedge price per $1 payout, micro-USD. "400000" = $0.40. */
  maxHedgePriceMicroUsd: PriceMicroUsd;
  /** Cap on total simulated hedge spending, mock USDC base units. "50000000" = 50.00. */
  hedgeBudget: TokenBaseUnits;
  /** No real market is linked. Replace with a real Gemini market ID once one is chosen. */
  geminiMarketId: null;
}

export const DEMO_PROMOTION: DemoPromotion = {
  isDemoData: true,
  id: "demo",
  name: "Sample Outcome Refund",
  description:
    "A fictional product or service used to demonstrate how an outcome-based refund promotion looks.",
  merchantName: "Sample Merchant",
  offerAmount: "5000000",
  refundCondition: "the example outcome happens",
  expiresAt: "2030-01-01T00:00:00Z",
  maxHedgePriceMicroUsd: "400000",
  hedgeBudget: "50000000",
  geminiMarketId: null,
};
