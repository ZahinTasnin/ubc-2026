import { createHash } from "node:crypto";
import type { HedgeRow } from "../store/types";

/**
 * Deterministic fingerprint of one simulated hedge: sha256 over a fixed, versioned field list.
 * Anyone holding the hedge record (receipt, dashboard, DB) can recompute it and compare. It is
 * meant to be written on-chain with mark_hedged once the escrow program has a field for it
 * (proposed to Dev 2); until then it is published in the purchase receipt.
 */
export const HEDGE_FINGERPRINT_VERSION = 1;

export function hedgeFingerprint(
  purchasePda: string,
  h: Pick<
    HedgeRow,
    | "marketId"
    | "requestedContracts"
    | "filledContracts"
    | "avgFillPriceMicroUsd"
    | "premium"
    | "quoteFetchedAt"
  >,
): string {
  const fields = [
    HEDGE_FINGERPRINT_VERSION,
    purchasePda,
    h.marketId,
    h.requestedContracts,
    h.filledContracts,
    h.avgFillPriceMicroUsd,
    h.premium === null ? null : h.premium.toString(),
    h.quoteFetchedAt === null ? null : new Date(h.quoteFetchedAt).toISOString(),
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
