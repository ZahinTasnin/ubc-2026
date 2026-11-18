import type {
  Base58,
  ChainPosition,
  ClaimKind,
  OnChainConfig,
  OnChainPromoAccount,
  OnChainPromoState,
  OnChainPurchaseAccount,
  OnChainPurchaseState,
  ProgramEvent,
} from "@hedged/shared";
import { PublicKey } from "@solana/web3.js";
import { createEventParser, escrowDecoder, ESCROW_PROGRAM_ID } from "./idl";
import { bytesToPurchaseId } from "./pda";

/**
 * Decoders from raw account data / transaction logs to the @hedged/shared shapes.
 * u64 -> decimal string, i64 -> number (unix seconds), enums -> the shared string unions.
 */

/** Config incl. `cancelTimeoutSecs` (on-chain field; not yet in the shared type on main). */
export type ConfigAccount = OnChainConfig & { cancelTimeoutSecs: number };
/** Promo incl. `cancelTimeoutSecs` (Rachel's backend branch adds it to OnChainPromoAccount). */
export type PromoAccount = OnChainPromoAccount & { cancelTimeoutSecs: number };

type Num = { toString(): string };
const str = (v: Num) => v.toString();
const int = (v: Num) => Number(v.toString());
const b58 = (v: PublicKey) => v.toBase58();

/** Anchor enums decode as `{ variantName: {} }`. */
export function enumVariant(v: unknown): string {
  if (typeof v === "string") return v;
  const keys = v && typeof v === "object" ? Object.keys(v) : [];
  if (keys.length !== 1) throw new Error(`not an Anchor enum value: ${JSON.stringify(v)}`);
  return keys[0]!;
}
const lc = (s: string) => s.toLowerCase().replace(/_/g, "");

const PROMO_STATES: Record<string, OnChainPromoState> = {
  active: "Active",
  resolvedyes: "ResolvedYes",
  resolvedno: "ResolvedNo",
};
const PURCHASE_STATES: Record<string, OnChainPurchaseState> = {
  deposited: "Deposited",
  hedged: "Hedged",
  cancelled: "Cancelled",
  refunded: "Refunded",
  claimedbycustomer: "ClaimedByCustomer",
  claimedbymerchant: "ClaimedByMerchant",
};
const CLAIM_KINDS: Record<string, ClaimKind> = {
  cancelrefund: "CANCEL_REFUND",
  yesrefund: "YES_REFUND",
  merchantpayout: "MERCHANT_PAYOUT",
};

function mapEnum<T extends string>(table: Record<string, T>, v: unknown, what: string): T {
  const name = lc(enumVariant(v));
  const out = table[name];
  if (!out) throw new Error(`unknown ${what} variant: ${name}`);
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Anchor's decoded structs are untyped here */
export function decodeConfig(data: Buffer): ConfigAccount {
  const c: any = escrowDecoder().coder.accounts.decode("config", data);
  return {
    admin: b58(c.admin),
    relayer: b58(c.relayer),
    mint: b58(c.mint),
    paused: Boolean(c.paused),
    cancelTimeoutSecs: int(c.cancelTimeoutSecs),
  };
}

export function decodePromo(
  promoPda: Base58,
  data: Buffer,
  vaultBalance: string | null = null,
): PromoAccount {
  const p: any = escrowDecoder().coder.accounts.decode("promo", data);
  const totalDeposited = BigInt(str(p.totalDeposited));
  const totalPaidOut = BigInt(str(p.totalPaidOut));
  return {
    promoPda,
    merchant: b58(p.merchant),
    mint: b58(p.mint),
    vault: b58(p.vault),
    promoNonce: str(p.promoNonce),
    offerAmount: str(p.offerAmount),
    depositDeadline: int(p.depositDeadline),
    marketId: String(p.marketId),
    state: mapEnum(PROMO_STATES, p.state, "PromoState"),
    resolvedAt: int(p.resolvedAt),
    totalDeposited: totalDeposited.toString(),
    totalPaidOut: totalPaidOut.toString(),
    purchaseCount: str(p.purchaseCount),
    outstanding: (totalDeposited - totalPaidOut).toString(),
    // null balance (vault not fetched) is reported as "0"; reads in accounts.ts always fetch it.
    vaultBalance: vaultBalance ?? "0",
    cancelTimeoutSecs: int(p.cancelTimeoutSecs),
  };
}

export function decodePurchase(purchasePda: Base58, data: Buffer): OnChainPurchaseAccount {
  const p: any = escrowDecoder().coder.accounts.decode("purchase", data);
  return {
    purchasePda,
    promoPda: b58(p.promo),
    customer: b58(p.customer),
    purchaseId: bytesToPurchaseId(p.purchaseId),
    amount: str(p.amount),
    state: mapEnum(PURCHASE_STATES, p.state, "PurchaseState"),
    depositedAt: int(p.depositedAt),
    hedgedAt: int(p.hedgedAt),
    cancelledAt: int(p.cancelledAt),
    settledAt: int(p.settledAt),
  };
}

/** Account discriminator (first 8 bytes) as base58, for getProgramAccounts memcmp filters. */
export function accountDiscriminatorB58(name: "config" | "promo" | "purchase"): string {
  const f = escrowDecoder().coder.accounts.memcmp(name) as { bytes: string };
  return f.bytes;
}

/** Decoded program event without its chain position. */
export type RawProgramEvent = ProgramEvent extends infer E
  ? E extends ProgramEvent
    ? Omit<E, keyof ChainPosition>
    : never
  : never;

const EVENT_NAMES = {
  depositevent: "DepositEvent",
  hedgemarkedevent: "HedgeMarkedEvent",
  purchasecancelledevent: "PurchaseCancelledEvent",
  resolutionevent: "ResolutionEvent",
  claimevent: "ClaimEvent",
} as const;

function mapEvent(name: string, d: any): RawProgramEvent | null {
  const n = EVENT_NAMES[lc(name) as keyof typeof EVENT_NAMES];
  switch (n) {
    case "DepositEvent":
      return {
        name: n,
        promo: b58(d.promo),
        purchase: b58(d.purchase),
        customer: b58(d.customer),
        purchaseId: bytesToPurchaseId(d.purchaseId),
        amount: str(d.amount),
        depositedAt: int(d.depositedAt),
      };
    case "HedgeMarkedEvent":
      return {
        name: n,
        promo: b58(d.promo),
        purchase: b58(d.purchase),
        relayer: b58(d.relayer),
        markedAt: int(d.markedAt),
      };
    case "PurchaseCancelledEvent":
      return {
        name: n,
        promo: b58(d.promo),
        purchase: b58(d.purchase),
        customer: b58(d.customer),
        amount: str(d.amount),
        cancelledAt: int(d.cancelledAt),
      };
    case "ResolutionEvent":
      return {
        name: n,
        promo: b58(d.promo),
        outcome: lc(enumVariant(d.outcome)) === "yes" ? "YES" : "NO",
        relayer: b58(d.relayer),
        resolvedAt: int(d.resolvedAt),
      };
    case "ClaimEvent": {
      const kind = CLAIM_KINDS[lc(enumVariant(d.kind))];
      // Tolerate future ClaimKind variants (INTEGRATION.md §7): skip rather than mislabel.
      if (!kind) return null;
      return {
        name: n,
        promo: b58(d.promo),
        purchase: b58(d.purchase),
        recipient: b58(d.recipient),
        amount: str(d.amount),
        kind,
        claimedAt: int(d.claimedAt),
      };
    }
    default:
      return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface IndexedEvent {
  /** 0-based index among THIS program's decoded events in the tx (the dedupe `eventIndex`). */
  eventIndex: number;
  event: RawProgramEvent;
}

/**
 * Decode this program's events from a transaction's log messages, in emission order. Unknown
 * future variants keep their slot in the numbering so `eventIndex` stays stable.
 */
export function decodeEventsFromLogs(
  logs: readonly string[],
  programId: PublicKey = ESCROW_PROGRAM_ID,
): IndexedEvent[] {
  if (logs.length === 0) return [];
  const out: IndexedEvent[] = [];
  let i = 0;
  for (const ev of createEventParser(programId).parseLogs([...logs])) {
    const mapped = mapEvent(ev.name, ev.data);
    if (mapped) out.push({ eventIndex: i, event: mapped });
    i++;
  }
  return out;
}
