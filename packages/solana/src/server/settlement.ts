import type { Base58, SubmitOptions, TxReceipt } from "@hedged/shared";
import { NotImplementedError } from "../errors";
import type { ServerSolanaConfig } from "./deposits";

/**
 * Relayer signer is injected by the host process (key loaded from RELAYER_KEYPAIR_PATH
 * server-side); keys never live in this package's source and are never exposed to apps/api code.
 * TODO(Dev 3): the final public surface is a `SolanaServerGateway` (@hedged/shared) factory that
 * closes over config + signer; these free functions are its building blocks.
 */
export interface RelayerSigner {
  publicKey: Base58;
  // TODO(Dev 3): sign(tx) shape once web3.js transaction flow is chosen.
}

/** `mark_hedged` — relayer only. Deposited -> Hedged. Idempotent (alreadyApplied). */
export async function markHedged(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _purchasePda: Base58,
  _opts?: SubmitOptions,
): Promise<TxReceipt> {
  throw new NotImplementedError("markHedged");
}

/** `cancel_unhedged` — relayer only. Deposited -> Cancelled (customer then calls claim_refund). */
export async function cancelUnhedged(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _purchasePda: Base58,
  _opts?: SubmitOptions,
): Promise<TxReceipt> {
  throw new NotImplementedError("cancelUnhedged");
}

/** `resolve_promo` — relayer only. Active -> ResolvedYes|ResolvedNo exactly once. */
export async function resolvePromotion(
  _cfg: ServerSolanaConfig,
  _relayer: RelayerSigner,
  _promoPda: Base58,
  _outcome: "YES" | "NO",
  _opts?: SubmitOptions,
): Promise<TxReceipt> {
  throw new NotImplementedError("resolvePromotion");
}
