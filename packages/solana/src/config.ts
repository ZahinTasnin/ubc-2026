import type { Base58 } from "@hedged/shared";

/** Explicit config object — no implicit env reads, so it stays browser-safe. */
export interface SolanaClientConfig {
  cluster: "devnet" | "localnet"; // mainnet intentionally unsupported in the MVP
  rpcUrl: string;
  wsUrl?: string;
  programId: Base58;
  mockUsdcMint: Base58;
}
