import { NotImplementedError } from "./errors";

/**
 * PDA derivation. TODO(Dev 2): finalize seed conventions and document in docs/interfaces.md
 * BEFORE Dev 1/3 depend on them (e.g. ["promo", merchant, promoNonce], ["purchase", promo, id]).
 */
export function derivePromoPda(_args: unknown): never {
  throw new NotImplementedError("derivePromoPda");
}

export function derivePurchasePda(_args: unknown): never {
  throw new NotImplementedError("derivePurchasePda");
}
