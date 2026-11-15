import { NotImplementedError } from "../errors";
import type { ServerSolanaConfig } from "./deposits";

/** Relayer signer is injected by the host process; keys never live in this package's source. */
export interface RelayerSigner {
  publicKey: string;
  // TODO(Dev 2): sign(tx) shape once web3.js transaction flow is chosen.
}

/** `mark_hedged` — relayer only. */
export async function markHedged(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _purchasePda: string,
): Promise<string> {
  throw new NotImplementedError("markHedged");
}

/** `cancel_unhedged` — returns full deposit to the customer ATA. */
export async function cancelUnhedged(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _purchasePda: string,
): Promise<string> {
  throw new NotImplementedError("cancelUnhedged");
}

/** `resolve_promo` — set the official YES/NO outcome exactly once. */
export async function resolvePromotion(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _promoPda: string,
  _outcome: "YES" | "NO",
): Promise<string> {
  throw new NotImplementedError("resolvePromotion");
}
