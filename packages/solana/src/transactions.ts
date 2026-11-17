import { NotImplementedError } from "./errors";

/**
 * Customer/merchant-signed transaction BUILDERS (unsigned; wallet signs in the browser).
 * TODO(Dev 3): implement against the generated IDL.
 */
export function buildDepositTransaction(_args: unknown): never {
  throw new NotImplementedError("buildDepositTransaction");
}
export function buildClaimRefundTransaction(_args: unknown): never {
  throw new NotImplementedError("buildClaimRefundTransaction");
}
export function buildClaimMerchantTransaction(_args: unknown): never {
  throw new NotImplementedError("buildClaimMerchantTransaction");
}
export function buildInitializePromoTransaction(_args: unknown): never {
  throw new NotImplementedError("buildInitializePromoTransaction");
}
