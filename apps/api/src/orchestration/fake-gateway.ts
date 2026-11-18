import {
  SolanaGatewayError,
  type ClaimEvent,
  type DepositEvent,
  type EventHandler,
  type GatewayErrorCode,
  type OnChainConfig,
  type OnChainPromoAccount,
  type OnChainPurchaseAccount,
  type ResolutionEvent,
  type SolanaServerGateway,
  type TxReceipt,
} from "@hedged/shared";

/**
 * IN-MEMORY FAKE of SolanaServerGateway, for tests and for running the backend before Dev 3's
 * real gateway exists. It is NOT Solana: no transactions, no signatures that exist on any chain.
 * It mimics the program's state rules (docs/interfaces.md §2) closely enough to exercise the
 * orchestrator's races: one-way transitions, Deposited-only hedge/cancel, resolve-after-deadline.
 */
export class FakeSolanaGateway implements SolanaServerGateway {
  config: OnChainConfig = {
    admin: "FAKE_ADMIN",
    relayer: "FAKE_RELAYER",
    mint: "FAKE_MINT",
    paused: false,
  };
  readonly promos = new Map<string, OnChainPromoAccount>();
  readonly purchases = new Map<string, OnChainPurchaseAccount>();
  readonly calls: { method: string; target: string }[] = [];
  private failures: { method: string; code: GatewayErrorCode; landAnyway: boolean }[] = [];
  private seq = 0;
  private depositHandlers: EventHandler<DepositEvent>[] = [];
  private resolutionHandlers: EventHandler<ResolutionEvent>[] = [];
  private claimHandlers: EventHandler<ClaimEvent>[] = [];

  constructor(private readonly nowUnix: () => number) {}

  // ---- test controls -------------------------------------------------------------------------

  /** Make the next call to `method` throw `code`. `landAnyway` = the tx still lands (TX_TIMEOUT). */
  failNext(method: string, code: GatewayErrorCode, times = 1, landAnyway = false): void {
    for (let i = 0; i < times; i++) this.failures.push({ method, code, landAnyway });
  }

  addPromo(
    p: Partial<OnChainPromoAccount> & Pick<OnChainPromoAccount, "promoPda">,
  ): OnChainPromoAccount {
    const promo: OnChainPromoAccount = {
      merchant: "FAKE_MERCHANT",
      mint: this.config.mint,
      vault: `${p.promoPda}_vault`,
      promoNonce: "0",
      offerAmount: "5000000",
      depositDeadline: this.nowUnix() + 3600,
      marketId: "GEMI-TEST-EVT-TEX",
      state: "Active",
      resolvedAt: 0,
      totalDeposited: "0",
      totalPaidOut: "0",
      purchaseCount: "0",
      outstanding: "0",
      vaultBalance: "0",
      cancelTimeoutSecs: 600,
      ...p,
    };
    this.promos.set(promo.promoPda, promo);
    return promo;
  }

  /** Simulate a customer's `deposit`; returns the verified event the real gateway would deliver. */
  deposit(promoPda: string, purchasePda: string, amount = "5000000"): DepositEvent {
    const now = this.nowUnix();
    this.purchases.set(purchasePda, {
      purchasePda,
      promoPda,
      customer: `${purchasePda}_customer`,
      purchaseId: purchasePda
        .padEnd(32, "0")
        .slice(0, 32)
        .replace(/[^0-9a-f]/g, "a"),
      amount,
      state: "Deposited",
      depositedAt: now,
      hedgedAt: 0,
      cancelledAt: 0,
      settledAt: 0,
    });
    const p = this.purchases.get(purchasePda)!;
    return {
      signature: this.sig("deposit"),
      eventIndex: 0,
      slot: ++this.seq,
      blockTime: now,
      commitment: "finalized",
      promo: promoPda,
      purchase: purchasePda,
      customer: p.customer,
      purchaseId: p.purchaseId,
      amount,
      depositedAt: now,
    };
  }

  /** Customer-signed `cancel_expired_deposit` (only from Deposited). */
  customerCancel(purchasePda: string): void {
    const p = this.mustPurchase(purchasePda);
    if (p.state !== "Deposited") throw new Error(`cannot customer-cancel ${p.state}`);
    p.state = "Cancelled";
    p.cancelledAt = this.nowUnix();
  }

  /** Customer/merchant claim; returns the event the real gateway would deliver. */
  claim(purchasePda: string): ClaimEvent {
    const p = this.mustPurchase(purchasePda);
    const promo = this.promos.get(p.promoPda)!;
    let kind: ClaimEvent["kind"];
    if (p.state === "Cancelled") {
      p.state = "Refunded";
      kind = "CANCEL_REFUND";
    } else if (p.state === "Hedged" && promo.state === "ResolvedYes") {
      p.state = "ClaimedByCustomer";
      kind = "YES_REFUND";
    } else if (p.state === "Hedged" && promo.state === "ResolvedNo") {
      p.state = "ClaimedByMerchant";
      kind = "MERCHANT_PAYOUT";
    } else throw new Error(`nothing to claim in ${p.state}/${promo.state}`);
    return {
      signature: this.sig("claim"),
      eventIndex: 0,
      slot: ++this.seq,
      blockTime: this.nowUnix(),
      commitment: "finalized",
      promo: p.promoPda,
      purchase: purchasePda,
      recipient: kind === "MERCHANT_PAYOUT" ? promo.merchant : p.customer,
      amount: p.amount,
      kind,
      claimedAt: this.nowUnix(),
    };
  }

  // ---- SolanaServerGateway -------------------------------------------------------------------

  async subscribeToDeposits(h: EventHandler<DepositEvent>) {
    this.depositHandlers.push(h);
    return {
      stop: async () => void (this.depositHandlers = this.depositHandlers.filter((x) => x !== h)),
    };
  }
  async subscribeToResolutions(h: EventHandler<ResolutionEvent>) {
    this.resolutionHandlers.push(h);
    return {
      stop: async () =>
        void (this.resolutionHandlers = this.resolutionHandlers.filter((x) => x !== h)),
    };
  }
  async subscribeToClaims(h: EventHandler<ClaimEvent>) {
    this.claimHandlers.push(h);
    return {
      stop: async () => void (this.claimHandlers = this.claimHandlers.filter((x) => x !== h)),
    };
  }

  async markHedged(purchasePda: string): Promise<TxReceipt> {
    return this.privileged("markHedged", purchasePda, () => {
      const p = this.mustPurchase(purchasePda);
      if (p.state === "Hedged") return true;
      if (this.config.paused) throw new SolanaGatewayError("PAUSED", "program paused");
      if (p.state !== "Deposited" || this.promos.get(p.promoPda)?.state !== "Active") {
        throw new SolanaGatewayError("INVALID_STATE", `cannot mark_hedged from ${p.state}`);
      }
      p.state = "Hedged";
      p.hedgedAt = this.nowUnix();
      return false;
    });
  }

  async cancelUnhedged(purchasePda: string): Promise<TxReceipt> {
    return this.privileged("cancelUnhedged", purchasePda, () => {
      const p = this.mustPurchase(purchasePda);
      if (p.state === "Cancelled") return true;
      if (p.state !== "Deposited") {
        throw new SolanaGatewayError("INVALID_STATE", `cannot cancel_unhedged from ${p.state}`);
      }
      p.state = "Cancelled";
      p.cancelledAt = this.nowUnix();
      return false;
    });
  }

  async resolvePromotion(promoPda: string, outcome: "YES" | "NO"): Promise<TxReceipt> {
    return this.privileged("resolvePromotion", promoPda, () => {
      const promo = this.promos.get(promoPda);
      if (!promo) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", promoPda);
      const want = outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
      if (promo.state === want) return true;
      if (promo.state !== "Active")
        throw new SolanaGatewayError("INVALID_STATE", "conflicting outcome");
      if (this.nowUnix() < promo.depositDeadline) {
        throw new SolanaGatewayError("INVALID_STATE", "ResolutionTooEarly");
      }
      if (this.config.paused) throw new SolanaGatewayError("PAUSED", "program paused");
      promo.state = want;
      promo.resolvedAt = this.nowUnix();
      return false;
    });
  }

  async getConfig() {
    this.consumeFailure("getConfig");
    return { ...this.config };
  }
  async getPromoState(promoPda: string) {
    this.consumeFailure("getPromoState");
    const p = this.promos.get(promoPda);
    return p ? { ...p } : null;
  }
  async getPurchaseState(purchasePda: string) {
    this.consumeFailure("getPurchaseState");
    const p = this.purchases.get(purchasePda);
    return p ? { ...p } : null;
  }
  async listPurchases(promoPda: string) {
    this.consumeFailure("listPurchases");
    return [...this.purchases.values()]
      .filter((p) => p.promoPda === promoPda)
      .map((p) => ({ ...p }));
  }
  async verifyTransaction(signature: string) {
    return {
      signature,
      confirmed: true,
      commitment: "finalized" as const,
      slot: null,
      err: null,
      events: [],
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  private async privileged(
    method: string,
    target: string,
    apply: () => boolean,
  ): Promise<TxReceipt> {
    this.calls.push({ method, target });
    const failure = this.takeFailure(method);
    if (failure?.landAnyway) apply();
    if (failure) throw new SolanaGatewayError(failure.code, `fake ${failure.code}`);
    const alreadyApplied = apply();
    return {
      signature: alreadyApplied ? null : this.sig(method),
      slot: ++this.seq,
      commitment: "finalized",
      alreadyApplied,
    };
  }

  private consumeFailure(method: string) {
    const f = this.takeFailure(method);
    if (f) throw new SolanaGatewayError(f.code, `fake ${f.code}`);
  }

  private takeFailure(method: string) {
    const i = this.failures.findIndex((f) => f.method === method);
    return i === -1 ? undefined : this.failures.splice(i, 1)[0];
  }

  private mustPurchase(pda: string): OnChainPurchaseAccount {
    const p = this.purchases.get(pda);
    if (!p) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", pda);
    return p;
  }

  private sig(kind: string): string {
    return `FAKE_${kind}_${++this.seq}`;
  }
}
