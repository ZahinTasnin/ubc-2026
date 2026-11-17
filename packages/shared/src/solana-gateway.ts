import type { Base58 } from "./money";
import type { ClaimEvent, DepositEvent, ProgramEvent, ResolutionEvent } from "./events";
import type { OnChainConfig, OnChainPromoAccount, OnChainPurchaseAccount } from "./onchain";

/**
 * Dev 3 <-> Dev 4 contract (spec: docs/interfaces.md "SolanaServerGateway"). apps/api (Dev 4)
 * depends ONLY on this interface — no web3.js/Anchor/RPC code, no private keys. Dev 3 implements it
 * in `@hedged/solana/server`; Dev 4 may write a clearly labeled in-memory fake.
 */

export type Commitment = "confirmed" | "finalized";

// ---- errors -------------------------------------------------------------------------------

export const GATEWAY_ERROR_CODES = [
  "RPC_UNAVAILABLE", // transport/RPC failure — retryable
  "TX_TIMEOUT", // sent but not confirmed in time; outcome UNKNOWN — re-read state, then retry
  "BLOCKHASH_EXPIRED", // not landed; safe to rebuild and resend — retryable
  "ACCOUNT_NOT_FOUND", // promo/purchase PDA does not exist (yet)
  "INVALID_STATE", // program rejected the transition (e.g. cancel of a Hedged purchase)
  "PAUSED", // program is paused for this instruction
  "NOT_AUTHORIZED", // relayer misconfigured / rotated — operator action, not retryable
  "VERIFICATION_FAILED", // tx/event failed independent verification (never trust it)
  "TX_FAILED", // landed and failed for another program error
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const GATEWAY_ERROR_RETRYABLE: Record<GatewayErrorCode, boolean> = {
  RPC_UNAVAILABLE: true,
  TX_TIMEOUT: true,
  BLOCKHASH_EXPIRED: true,
  ACCOUNT_NOT_FOUND: true, // may appear after confirmation lag
  INVALID_STATE: false,
  PAUSED: false, // retry only after an operator unpauses
  NOT_AUTHORIZED: false,
  VERIFICATION_FAILED: false,
  TX_FAILED: false,
};

export class SolanaGatewayError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly signature?: Base58,
  ) {
    super(message);
    this.name = "SolanaGatewayError";
    this.retryable = GATEWAY_ERROR_RETRYABLE[code];
  }
}

// ---- receipts / verification ---------------------------------------------------------------

/**
 * Result of a privileged call. Resolves only after the tx reached `commitment` AND the purchase /
 * promo state was re-read and matches the intended transition.
 *
 * Idempotency: if the target state already holds (e.g. markHedged on a Hedged purchase), the
 * call does NOT throw: it resolves with `alreadyApplied: true` and, when it can be found, the
 * signature of the original transition. A call that would be an INVALID transition (e.g.
 * cancelUnhedged on a Hedged purchase) throws SolanaGatewayError("INVALID_STATE").
 */
export interface TxReceipt {
  /** null only when `alreadyApplied` and the original tx could not be located. */
  signature: Base58 | null;
  slot: number | null;
  commitment: Commitment;
  alreadyApplied: boolean;
}

export interface TxVerification {
  signature: Base58;
  /** Landed, no error, at (at least) the requested commitment. */
  confirmed: boolean;
  commitment: Commitment | null;
  slot: number | null;
  err: string | null;
  /** Verified program events emitted by this tx, in order. */
  events: ProgramEvent[];
}

export interface SubmitOptions {
  /** Default: the gateway's configured commitment (MVP: "finalized"). */
  commitment?: Commitment;
  /** Overall budget including retries of resend-safe failures. */
  timeoutMs?: number;
}

// ---- subscriptions -------------------------------------------------------------------------

export interface Unsubscribe {
  stop(): Promise<void>;
}

/**
 * Subscription contract (all three):
 * - Handler receives only VERIFIED events at the configured commitment.
 * - At-least-once delivery, deduped best-effort by `chainEventId`; handlers MUST be idempotent
 *   and MUST decide from on-chain state (getPurchaseState/getPromoState), not event order.
 * - Resolves (ack) => checkpoint advanced; throws => event redelivered with backoff.
 * - `fromSlot` replays history after a restart; the host (Dev 4) persists the last acked slot.
 */
export interface SubscribeOptions {
  fromSlot?: number;
}
export type EventHandler<E> = (event: E) => Promise<void>;

// ---- gateway -------------------------------------------------------------------------------

export interface SolanaServerGateway {
  subscribeToDeposits(
    onDeposit: EventHandler<DepositEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe>;
  subscribeToResolutions(
    onResolution: EventHandler<ResolutionEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe>;
  /** Customer/merchant-signed claims; lets the backend record REFUNDED / CLAIMED once verified. */
  subscribeToClaims(
    onClaim: EventHandler<ClaimEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe>;

  /** Relayer-signed `mark_hedged`: Deposited -> Hedged. Idempotent (see TxReceipt). */
  markHedged(purchasePda: Base58, opts?: SubmitOptions): Promise<TxReceipt>;
  /** Relayer-signed `cancel_unhedged`: Deposited -> Cancelled (refund entitlement). Idempotent. */
  cancelUnhedged(purchasePda: Base58, opts?: SubmitOptions): Promise<TxReceipt>;
  /** Relayer-signed `resolve_promo`: Active -> ResolvedYes|ResolvedNo exactly once. Idempotent for
   * the SAME outcome; a conflicting outcome throws INVALID_STATE. */
  resolvePromotion(
    promoPda: Base58,
    outcome: "YES" | "NO",
    opts?: SubmitOptions,
  ): Promise<TxReceipt>;

  /** Reads return null if the account does not exist. Always reflect on-chain truth. */
  getConfig(): Promise<OnChainConfig | null>;
  getPromoState(promoPda: Base58, commitment?: Commitment): Promise<OnChainPromoAccount | null>;
  getPurchaseState(
    purchasePda: Base58,
    commitment?: Commitment,
  ): Promise<OnChainPurchaseAccount | null>;
  /** Reconciliation scan for missed events: every purchase of a promotion. */
  listPurchases(promoPda: Base58, commitment?: Commitment): Promise<OnChainPurchaseAccount[]>;

  /** Independently verify a transaction (e.g. a customer's claim tx, or a stored receipt). */
  verifyTransaction(signature: Base58, commitment?: Commitment): Promise<TxVerification>;
}
