import type { PurchaseStatus, TokenBaseUnits } from "@hedged/shared";
import { DEMO_PROMOTION } from "./promotions";

/**
 * DEMO DATA: a fictional purchase for building and demoing the receipt UI.
 *
 * - No mock USDC deposit happened. There is no wallet, no transaction and no on-chain account.
 * - The shared `Purchase` type requires a real purchase PDA, customer wallet and deposit
 *   signature, and inventing those would make this look real. So this is a smaller frontend-only
 *   display type; wallet and signature are `null` and cannot hold a value.
 * - `status` is a hypothetical UI scenario picked from the existing shared PurchaseStatus values.
 *   It is NOT confirmed blockchain or backend state.
 *
 * Any UI that shows this record must label it as a demo.
 */
export interface DemoPurchase {
  /** Always true. Lets a UI check "is this demo data?" and show a Demo badge. */
  readonly isDemoData: true;
  /** Placeholder id for routes like /purchases/[purchaseId]. Not a database or on-chain id. */
  id: string;
  /** Which DemoPromotion this fictional purchase belongs to. */
  promotionId: string;
  /** Purchase amount, mock USDC base units (copied from the demo promotion's price). */
  amount: TokenBaseUnits;

  /** Illustrative status for the UI only. Existing shared status, nothing new invented. */
  status: PurchaseStatus;
  /** Always true: `status` is a hypothetical scenario, not a confirmed state. */
  readonly statusIsHypothetical: true;

  // Things that did NOT happen. Literal types, so they cannot be changed to "real" values.
  /** No mock USDC was deposited. */
  readonly depositOccurred: false;
  /** No customer wallet exists for this record. */
  customerWallet: null;
  /** No Solana transaction exists for this record. */
  txSignature: null;
  /** No purchase date: nothing was purchased. */
  purchasedAt: null;
  /** No official market outcome exists, so nothing can be resolved. */
  marketOutcome: null;
  /** Refund eligibility has not been verified (and cannot be: there is no on-chain purchase). */
  readonly refundEligibilityVerified: false;
  /** Merchant claim eligibility has not been verified either. */
  readonly merchantClaimEligibilityVerified: false;
  /** No refund or merchant claim can be executed for this record. */
  readonly claimsExecutable: false;
}

export const DEMO_PURCHASE: DemoPurchase = {
  isDemoData: true,
  id: "demo",
  promotionId: DEMO_PROMOTION.id,
  amount: DEMO_PROMOTION.offerAmount,

  status: "HEDGE_SIMULATED",
  statusIsHypothetical: true,

  depositOccurred: false,
  customerWallet: null,
  txSignature: null,
  purchasedAt: null,
  marketOutcome: null,
  refundEligibilityVerified: false,
  merchantClaimEligibilityVerified: false,
  claimsExecutable: false,
};
