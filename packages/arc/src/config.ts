import { arcTestnet } from "viem/chains";
import type { Address } from "viem";

/**
 * Arc network constants (verified 2026-11-17 against the live testnet RPC and docs.arc.io):
 * - chain id 5042002 (`eth_chainId` = 0x4cef52); viem ships it as `arcTestnet`.
 * - USDC is the native gas token (18 decimals). Its optional ERC-20 interface lives at
 *   0x3600000000000000000000000000000000000000 and uses 6 decimals (`decimals()` = 6, symbol USDC);
 *   both views share one balance. The escrow uses the 6-decimal ERC-20 interface, so amounts keep
 *   the same base units as the Solana mock mint (5 USDC = 5_000_000).
 * - Sub-second deterministic finality; the RPC supports the `finalized` block tag.
 * Sources: https://docs.arc.io/arc/references/connect-to-arc.md,
 * https://docs.arc.io/arc/references/contract-addresses.md, https://docs.arc.io/arc/references/evm-differences.md
 */
export const ARC_TESTNET = arcTestnet;
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";
export const ARC_TESTNET_EXPLORER = "https://explorer.testnet.arc.io";
export const ARC_USDC_ERC20: Address = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;

export interface ArcClientConfig {
  /** HedgedEscrow contract address. */
  escrow: Address;
  /** ERC-20 used by the escrow (Arc testnet: ARC_USDC_ERC20; anvil: the MockUSDC address). */
  token: Address;
}

/** Contract address from env (`ARC_ESCROW_ADDRESS`, browser: `NEXT_PUBLIC_ARC_ESCROW_ADDRESS`). */
export function escrowAddressFromEnv(env: Record<string, string | undefined>): Address | null {
  const v = env.ARC_ESCROW_ADDRESS ?? env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;
}
