import type {
  Base58,
  DepositEvent,
  HedgeFailureReason,
  HedgeStatus,
  MarketOutcome,
  MarketQuote,
  OnChainPromoState,
  OnChainPurchaseState,
  PurchaseStatus,
} from "@hedged/shared";

/**
 * Persistence boundary for the orchestrator. Mirrors supabase/migrations/*_init.sql. Two
 * implementations: MemoryStore (tests / local dev, clearly not durable) and a Supabase store.
 * Every method that guards an invariant (CAS transitions, one hedge per purchase, budget
 * reservation) must do so atomically in the implementation, not in the caller.
 */

export interface PromotionRow {
  id: string;
  promoPda: Base58;
  merchant: Base58;
  offerAmount: bigint;
  depositDeadline: number;
  onChainState: OnChainPromoState;
  geminiMarketId: string;
  outcomeLabel: string;
  maxYesPriceMicroUsd: bigint;
  hedgeBudget: bigint;
  reservedPremium: bigint;
  resolvedOutcome: "YES" | "NO" | null;
  resolveTxSignature: Base58 | null;
}

export interface PurchaseRow {
  id: string;
  promotionId: string;
  purchasePda: Base58;
  purchaseIdHex: string;
  customer: Base58;
  amount: bigint;
  depositTxSignature: Base58;
  depositEventIndex: number;
  depositedAt: number;
  onChainState: OnChainPurchaseState;
  status: PurchaseStatus;
  attempts: number;
  lastError: string | null;
  needsReconciliation: boolean;
  markHedgedTxSignature: Base58 | null;
  cancelTxSignature: Base58 | null;
  claimTxSignature: Base58 | null;
}

export interface HedgeRow {
  id: string;
  purchaseId: string;
  promotionId: string;
  simulated: true;
  marketId: string;
  quoteId: string | null;
  status: HedgeStatus;
  failureReason: HedgeFailureReason | null;
  requestedContracts: string;
  filledContracts: string;
  avgFillPriceMicroUsd: string | null;
  premium: bigint | null;
  modeledFee: bigint;
  reservedPremium: bigint;
  virtualPayout: bigint | null;
  assumptions: string[];
  quoteFetchedAt: string | null;
  settledAt: string | null;
}

export type NewHedge = Omit<
  HedgeRow,
  "id" | "reservedPremium" | "virtualPayout" | "settledAt" | "simulated"
>;

export class BudgetExceededError extends Error {
  constructor() {
    super("Simulated premium exceeds the promotion's remaining hedge budget");
    this.name = "BudgetExceededError";
  }
}

export type NewPromotion = Omit<
  PromotionRow,
  "id" | "reservedPremium" | "resolvedOutcome" | "resolveTxSignature" | "onChainState"
>;

export interface Store {
  createPromotion(promotion: NewPromotion): Promise<PromotionRow>;
  getPromotionByPda(promoPda: Base58): Promise<PromotionRow | null>;
  getPromotion(id: string): Promise<PromotionRow | null>;
  /** Promotions still Active on-chain (reconciliation sweep). */
  listActivePromotions(): Promise<PromotionRow[]>;
  /** Promotions still Active on-chain whose deposit deadline has passed. */
  listPromotionsDueForResolution(nowUnix: number): Promise<PromotionRow[]>;
  setPromotionResolved(
    id: string,
    outcome: "YES" | "NO",
    txSignature: Base58 | null,
  ): Promise<void>;

  /**
   * Record a verified deposit. Idempotent on (signature, eventIndex) AND on purchasePda: a
   * duplicate returns the existing row with created=false.
   */
  recordDeposit(
    event: DepositEvent,
    promotionId: string,
  ): Promise<{ purchase: PurchaseRow; created: boolean }>;
  getPurchaseByPda(purchasePda: Base58): Promise<PurchaseRow | null>;
  listPurchases(promotionId: string): Promise<PurchaseRow[]>;
  /** Compare-and-set. Returns the updated row, or null if status was not in `from`. */
  transitionPurchase(
    purchasePda: Base58,
    from: readonly PurchaseStatus[],
    to: PurchaseStatus,
    patch?: Partial<
      Pick<
        PurchaseRow,
        | "lastError"
        | "onChainState"
        | "needsReconciliation"
        | "markHedgedTxSignature"
        | "cancelTxSignature"
        | "claimTxSignature"
      >
    >,
  ): Promise<PurchaseRow | null>;
  /** Non-status bookkeeping (errors, flags, mirrored on-chain state). */
  patchPurchase(
    purchasePda: Base58,
    patch: Partial<Pick<PurchaseRow, "lastError" | "onChainState" | "needsReconciliation">>,
  ): Promise<void>;

  recordQuote(quote: MarketQuote): Promise<string>;
  /**
   * Insert the single hedge for a purchase, reserving its premium (if filled) against the
   * promotion budget atomically. Returns the existing hedge unchanged if one exists. Throws
   * BudgetExceededError if the reservation does not fit.
   */
  reserveHedge(hedge: NewHedge): Promise<HedgeRow>;
  getHedgeByPurchase(purchaseId: string): Promise<HedgeRow | null>;
  /** Void a live simulated hedge and release its reservation. Idempotent. */
  voidHedge(hedgeId: string, reason: HedgeFailureReason): Promise<HedgeRow>;
  settleHedge(
    hedgeId: string,
    settlement: {
      status: "SETTLED_WIN" | "SETTLED_LOSS";
      virtualPayout: bigint;
      settledAt: string;
    },
  ): Promise<void>;

  saveOutcome(outcome: MarketOutcome): Promise<void>;

  /** Dedupe any verified chain event. Returns false if it was already recorded. */
  markEventProcessed(
    eventId: string,
    name: string,
    slot: number,
    payload: unknown,
  ): Promise<boolean>;
  getCheckpoint(name: string): Promise<number | null>;
  setCheckpoint(name: string, slot: number): Promise<void>;
}
