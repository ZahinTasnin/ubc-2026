import type { DepositEvent } from "@hedged/shared";
import { NotImplementedError } from "../errors";

export interface ServerSolanaConfig {
  rpcUrl: string;
  wsUrl: string;
  programId: string;
  mockUsdcMint: string;
  /** Required commitment before a deposit is surfaced to the app. */
  commitment: "confirmed" | "finalized";
}

export interface DepositSubscription {
  stop(): Promise<void>;
}

/**
 * Independently verify a deposit tx: success, program ID, mint, accounts, amount, finality, and
 * event position. TODO(Dev 2). A WebSocket notification alone is NOT durable finality.
 */
export async function verifyDeposit(
  _cfg: ServerSolanaConfig,
  _signature: string,
): Promise<DepositEvent[]> {
  throw new NotImplementedError("verifyDeposit");
}

/**
 * Emit only VERIFIED deposit events; dedupe by (signature, eventIndex); replay from checkpoint
 * after disconnects. TODO(Dev 2): QuickNode Streams or WSS logs subscription.
 */
export async function subscribeToDeposits(
  _cfg: ServerSolanaConfig,
  _onDeposit: (e: DepositEvent) => Promise<void>,
  _opts?: { fromSlot?: number },
): Promise<DepositSubscription> {
  throw new NotImplementedError("subscribeToDeposits");
}
