import type {
  Commitment,
  OnChainConfig,
  OnChainPromoAccount,
  OnChainPromoState,
  OnChainPurchaseAccount,
  OnChainPurchaseState,
} from "@hedged/shared";
import { erc20Abi, type Address, type BlockTag, type Hex, type PublicClient } from "viem";
import { HEDGED_ESCROW_ABI } from "./abi";
import { fromBytes16 } from "./ids";

export const PROMO_STATES: readonly OnChainPromoState[] = ["Active", "ResolvedYes", "ResolvedNo"];
export const PURCHASE_STATES: readonly OnChainPurchaseState[] = [
  "Deposited",
  "Hedged",
  "Cancelled",
  "Refunded",
  "ClaimedByCustomer",
  "ClaimedByMerchant",
];

/** "finalized" -> the `finalized` block tag; "confirmed" -> `latest` (Arc finality is sub-second). */
export const blockTagFor = (c: Commitment | undefined): BlockTag =>
  c === "confirmed" ? "latest" : "finalized";

/** Arc promo: the Solana shape plus the per-promo cancel-timeout snapshot. */
export type ArcPromoAccount = OnChainPromoAccount & { cancelTimeoutSecs: number };
export type ArcConfig = OnChainConfig & { cancelTimeoutSecs: number };

export async function getConfig(
  client: PublicClient,
  escrow: Address,
  commitment?: Commitment,
): Promise<ArcConfig | null> {
  const blockTag = blockTagFor(commitment);
  const code = await client.getCode({ address: escrow, blockTag });
  if (!code || code === "0x") return null;
  const rd = <T>(functionName: "admin" | "relayer" | "token" | "paused" | "cancelTimeoutSecs") =>
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName,
      blockTag,
    }) as Promise<T>;
  const [admin, relayer, token, paused, timeout] = await Promise.all([
    rd<Address>("admin"),
    rd<Address>("relayer"),
    rd<Address>("token"),
    rd<boolean>("paused"),
    rd<bigint>("cancelTimeoutSecs"),
  ]);
  return { admin, relayer, mint: token, paused, cancelTimeoutSecs: Number(timeout) };
}

export async function getPromoState(
  client: PublicClient,
  escrow: Address,
  promoId: Hex,
  commitment?: Commitment,
): Promise<ArcPromoAccount | null> {
  const blockTag = blockTagFor(commitment);
  const [p, token] = await Promise.all([
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "getPromo",
      args: [promoId],
      blockTag,
    }),
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "token",
      blockTag,
    }),
  ]);
  if (!p.exists) return null;
  const vaultBalance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [escrow],
    blockTag,
  });
  return {
    promoPda: promoId,
    merchant: p.merchant,
    mint: token,
    // One contract holds every promo's funds (per-promo accounting below); see README "Vault model".
    vault: escrow,
    promoNonce: p.promoNonce.toString(),
    offerAmount: p.offerAmount.toString(),
    depositDeadline: Number(p.depositDeadline),
    marketId: p.marketId,
    state: PROMO_STATES[p.state] ?? "Active",
    resolvedAt: Number(p.resolvedAt),
    totalDeposited: p.totalDeposited.toString(),
    totalPaidOut: p.totalPaidOut.toString(),
    purchaseCount: p.purchaseCount.toString(),
    outstanding: (p.totalDeposited - p.totalPaidOut).toString(),
    // Contract-wide token balance (pooled across promos): always >= the sum of all outstanding.
    vaultBalance: vaultBalance.toString(),
    cancelTimeoutSecs: Number(p.cancelTimeoutSecs),
  };
}

type RawPurchase = {
  promo: Hex;
  customer: Address;
  purchaseId: Hex;
  amount: bigint;
  state: number;
  depositedAt: bigint;
  hedgedAt: bigint;
  cancelledAt: bigint;
  settledAt: bigint;
  exists: boolean;
};

export function mapPurchase(purchaseKey: Hex, u: RawPurchase): OnChainPurchaseAccount {
  return {
    purchasePda: purchaseKey,
    promoPda: u.promo,
    customer: u.customer,
    purchaseId: fromBytes16(u.purchaseId),
    amount: u.amount.toString(),
    state: PURCHASE_STATES[u.state] ?? "Deposited",
    depositedAt: Number(u.depositedAt),
    hedgedAt: Number(u.hedgedAt),
    cancelledAt: Number(u.cancelledAt),
    settledAt: Number(u.settledAt),
  };
}

export async function getPurchaseState(
  client: PublicClient,
  escrow: Address,
  purchaseKey: Hex,
  commitment?: Commitment,
): Promise<OnChainPurchaseAccount | null> {
  const u = (await client.readContract({
    address: escrow,
    abi: HEDGED_ESCROW_ABI,
    functionName: "getPurchase",
    args: [purchaseKey],
    blockTag: blockTagFor(commitment),
  })) as RawPurchase;
  return u.exists ? mapPurchase(purchaseKey, u) : null;
}

/** Every purchase of a promotion (reconciliation scan), in deposit order. */
export async function listPurchases(
  client: PublicClient,
  escrow: Address,
  promoId: Hex,
  commitment?: Commitment,
): Promise<OnChainPurchaseAccount[]> {
  const blockTag = blockTagFor(commitment);
  const n = await client.readContract({
    address: escrow,
    abi: HEDGED_ESCROW_ABI,
    functionName: "purchaseCountOf",
    args: [promoId],
    blockTag,
  });
  const out: OnChainPurchaseAccount[] = [];
  const PAGE = 200n;
  for (let off = 0n; off < n; off += PAGE) {
    const keys = await client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "purchaseKeysOf",
      args: [promoId, off, PAGE],
      blockTag,
    });
    const rows = await Promise.all(
      keys.map((k) =>
        client.readContract({
          address: escrow,
          abi: HEDGED_ESCROW_ABI,
          functionName: "getPurchase",
          args: [k],
          blockTag,
        }),
      ),
    );
    rows.forEach((u, i) => {
      const k = keys[i];
      if (k && (u as RawPurchase).exists) out.push(mapPurchase(k, u as RawPurchase));
    });
  }
  return out;
}
