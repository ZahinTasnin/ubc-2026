import type { OnChainPurchaseState, Purchase } from "@hedged/shared";
import { NotImplementedError } from "./errors";

/** On-chain Purchase account view (authoritative for escrow). TODO(Dev 2): decode via IDL. */
export type OnChainPurchase = Purchase["onChain"] & { state: OnChainPurchaseState };

export async function getPurchaseState(_purchasePda: string): Promise<OnChainPurchase> {
  throw new NotImplementedError("getPurchaseState");
}
