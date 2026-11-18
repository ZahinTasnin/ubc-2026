import type { Base58, OnChainPurchaseAccount } from "@hedged/shared";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import {
  accountDiscriminatorB58,
  decodeConfig,
  decodePromo,
  decodePurchase,
  type ConfigAccount,
  type PromoAccount,
} from "./codec";
import { ESCROW_PROGRAM_ID } from "./idl";
import { deriveConfigPda } from "./pda";

/**
 * Authoritative on-chain reads (browser-safe). Each returns null when the account does not exist.
 * On-chain Promo/Purchase accounts are the source of truth for escrow (docs/interfaces.md §3).
 */

/** Byte offset of `Purchase.promo` (first field after the 8-byte discriminator). */
export const PURCHASE_PROMO_OFFSET = 8;

const pk = (v: Base58 | PublicKey) => (typeof v === "string" ? new PublicKey(v) : v);

/** Owner check: an account at the PDA must belong to the escrow program. */
function assertOwner(owner: PublicKey, programId: PublicKey, address: string): void {
  if (!owner.equals(programId)) {
    throw new Error(`account ${address} is owned by ${owner.toBase58()}, not the escrow program`);
  }
}

export async function getConfigAccount(
  connection: Connection,
  programId: PublicKey = ESCROW_PROGRAM_ID,
  commitment?: Commitment,
): Promise<ConfigAccount | null> {
  const address = deriveConfigPda(programId.toBase58()).address;
  const info = await connection.getAccountInfo(new PublicKey(address), commitment);
  if (!info) return null;
  assertOwner(info.owner, programId, address);
  return decodeConfig(info.data);
}

export async function getPromoState(
  connection: Connection,
  promoPda: Base58,
  opts: { programId?: PublicKey; commitment?: Commitment } = {},
): Promise<PromoAccount | null> {
  const programId = opts.programId ?? ESCROW_PROGRAM_ID;
  const info = await connection.getAccountInfo(pk(promoPda), opts.commitment);
  if (!info) return null;
  assertOwner(info.owner, programId, promoPda);
  const promo = decodePromo(promoPda, info.data);
  const bal = await connection
    .getTokenAccountBalance(new PublicKey(promo.vault), opts.commitment)
    .catch(() => null);
  return { ...promo, vaultBalance: bal?.value.amount ?? "0" };
}

export async function getPurchaseState(
  connection: Connection,
  purchasePda: Base58,
  opts: { programId?: PublicKey; commitment?: Commitment } = {},
): Promise<OnChainPurchaseAccount | null> {
  const programId = opts.programId ?? ESCROW_PROGRAM_ID;
  const info = await connection.getAccountInfo(pk(purchasePda), opts.commitment);
  if (!info) return null;
  assertOwner(info.owner, programId, purchasePda);
  return decodePurchase(purchasePda, info.data);
}

/** Every purchase of a promotion (reconciliation scan): memcmp on `Purchase.promo` at offset 8. */
export async function listPurchases(
  connection: Connection,
  promoPda: Base58,
  opts: { programId?: PublicKey; commitment?: Commitment } = {},
): Promise<OnChainPurchaseAccount[]> {
  const programId = opts.programId ?? ESCROW_PROGRAM_ID;
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: opts.commitment,
    filters: [
      { memcmp: { offset: 0, bytes: accountDiscriminatorB58("purchase") } },
      { memcmp: { offset: PURCHASE_PROMO_OFFSET, bytes: pk(promoPda).toBase58() } },
    ],
  });
  return accounts
    .map((a) => decodePurchase(a.pubkey.toBase58(), a.account.data))
    .sort((a, b) => a.depositedAt - b.depositedAt || a.purchasePda.localeCompare(b.purchasePda));
}

/** Cluster time (unix seconds) from the block time of a recent slot, never the local clock. */
export async function getClusterTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const t = await connection.getBlockTime(slot);
  if (t == null) throw new Error(`no block time for slot ${slot}`);
  return t;
}

/**
 * INTEGRATION.md §4: a customer may timeout-cancel iff the purchase is still Deposited and
 * `depositedAt + promo.cancelTimeoutSecs <= chainNow` (inclusive). Use cluster time.
 */
export function canTimeoutCancel(
  purchase: Pick<OnChainPurchaseAccount, "state" | "depositedAt">,
  promo: { cancelTimeoutSecs: number },
  chainNowSeconds: number,
): boolean {
  return (
    purchase.state === "Deposited" &&
    purchase.depositedAt + promo.cancelTimeoutSecs <= chainNowSeconds
  );
}
