import type { IsoTimestamp, PriceMicroUsd, TokenBaseUnits } from "./money";
import type { HedgeFailureReason, HedgeStatus } from "./status";

/**
 * SIMULATED hedge record (off-chain ledger). `simulated` is always true: no Gemini order is ever
 * placed, and no real money moves. UIs/logs must label it as simulated.
 */
export interface Hedge {
  id: string;
  simulated: true;
  purchaseId: string;
  marketId: string;
  status: HedgeStatus;
  /** Requested $1-payout YES contracts (whole contracts). */
  requestedContracts: string;
  /** Contracts assumed filled given observed depth (may be < requested). */
  filledContracts: string;
  /** Volume-weighted assumed fill price, micro-USD per contract. */
  avgFillPriceMicroUsd: PriceMicroUsd | null;
  /** Simulated premium (base units of the mock stablecoin equivalent). */
  premium: TokenBaseUnits | null;
  failureReason: HedgeFailureReason | null;
  /** Virtual payout once settled (YES = filledContracts * $1). */
  virtualPayout: TokenBaseUnits | null;
  quoteFetchedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  settledAt: IsoTimestamp | null;
}
