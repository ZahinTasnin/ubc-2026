import type { Base58 } from "@hedged/shared";
import { ESCROW_PROGRAM_ID } from "./idl";

/** Explicit config object — no implicit env reads, so it stays browser-safe. */
export interface SolanaClientConfig {
  cluster: "devnet" | "localnet"; // mainnet intentionally unsupported in the MVP
  rpcUrl: string;
  wsUrl?: string;
  programId: Base58;
  mockUsdcMint: Base58;
}

/** Public Devnet fallback. Prefer a QuickNode endpoint (server: QUICKNODE_RPC_URL). */
export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEFAULT_PROGRAM_ID: Base58 = ESCROW_PROGRAM_ID.toBase58();

/** Genesis hashes used to refuse mainnet (CLAUDE.md §2: Devnet only). */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Host only: QuickNode URLs embed an API key, so never log a full RPC URL. */
export function redactRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "(invalid url)";
  }
}
