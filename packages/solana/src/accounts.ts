import type { OnChainPromoAccount, OnChainPurchaseAccount } from "@hedged/shared";
import { NotImplementedError } from "./errors";

/** Authoritative on-chain reads (browser-safe). TODO(Dev 3): decode via the Dev 2 IDL. */
export async function getPromoState(_promoPda: string): Promise<OnChainPromoAccount | null> {
  throw new NotImplementedError("getPromoState");
}

export async function getPurchaseState(
  _purchasePda: string,
): Promise<OnChainPurchaseAccount | null> {
  throw new NotImplementedError("getPurchaseState");
}
