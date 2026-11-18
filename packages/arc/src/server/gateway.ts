import {
  SolanaGatewayError,
  type ClaimEvent,
  type Commitment,
  type DepositEvent,
  type EventHandler,
  type OnChainPurchaseAccount,
  type OnChainPurchaseState,
  type ResolutionEvent,
  type SolanaServerGateway,
  type SubmitOptions,
  type SubscribeOptions,
  type TxReceipt,
  type TxVerification,
  type Unsubscribe,
} from "@hedged/shared";
import {
  parseAbiItem,
  type Address,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  getConfig,
  getPromoState,
  getPurchaseState,
  listPurchases,
  type ArcConfig,
  type ArcPromoAccount,
} from "../accounts";
import { isBytes32 } from "../ids";
import { ArcEventSource } from "./events";
import { type ArcStreamsSignal } from "./streams";
import { ProgramFailure, RpcFailure, SubmitTimeout, submitRelayerCall } from "./submit";
import { verifyArcTransaction } from "./verify";

/**
 * Arc implementation of the SAME `SolanaServerGateway` interface (docs/interfaces.md §4), so the
 * backend switches with one line. Mapping: `purchasePda`/`promoPda` = bytes32 ids (0x...),
 * `signature` = tx hash, `slot` = block number, commitment "finalized" = Arc's finalized head.
 * SERVER ONLY: holds the relayer key.
 */
export interface ArcGatewayOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayer: PrivateKeyAccount;
  escrow: Address;
  token: Address;
  commitment?: Commitment;
  timeoutMs?: number;
  eventSource?: "poll" | "websocket" | "streams";
  wssUrl?: string;
  sweepMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export class GatewayInvalidStateError extends SolanaGatewayError {
  constructor(
    message: string,
    readonly observedState: OnChainPurchaseState | ArcPromoAccount["state"] | null,
    signature?: string,
  ) {
    super("INVALID_STATE", message, signature);
    this.name = "GatewayInvalidStateError";
  }
}

export class ResolutionTooEarlyError extends SolanaGatewayError {
  constructor(readonly retryAfterUnix: number) {
    super("TX_FAILED", `ResolutionTooEarly: retry at/after ${retryAfterUnix}`);
    this.name = "ResolutionTooEarlyError";
    Object.defineProperty(this, "retryable", { value: true });
  }
}

const HEDGE_MARKED = parseAbiItem(
  "event HedgeMarkedEvent(bytes32 indexed promo, bytes32 indexed purchase, address relayer, uint64 markedAt)",
);
const CANCELLED = parseAbiItem(
  "event PurchaseCancelledEvent(bytes32 indexed promo, bytes32 indexed purchase, address indexed customer, uint64 amount, uint64 cancelledAt)",
);
const RESOLVED = parseAbiItem(
  "event ResolutionEvent(bytes32 indexed promo, uint8 outcome, address relayer, uint64 resolvedAt)",
);

export class ArcGateway implements SolanaServerGateway {
  readonly commitment: Commitment;
  private readonly timeoutMs: number;
  private readonly events: ArcEventSource;

  constructor(private readonly o: ArcGatewayOptions) {
    this.commitment = o.commitment ?? "finalized";
    this.timeoutMs = o.timeoutMs ?? 60_000;
    this.events = new ArcEventSource({
      client: o.publicClient,
      escrow: o.escrow,
      commitment: this.commitment,
      verify: (tx) => this.verifyTransaction(tx),
      mode: o.eventSource ?? "poll",
      wssUrl: o.wssUrl,
      sweepMs: o.sweepMs,
      log: o.log,
    });
  }

  get relayerAddress(): Address {
    return this.o.relayer.address;
  }

  // ------------------------------------------------------------------ subscriptions

  async subscribeToDeposits(
    h: EventHandler<DepositEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["DepositEvent"], h, opts);
  }
  async subscribeToResolutions(
    h: EventHandler<ResolutionEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["ResolutionEvent"], h, opts);
  }
  async subscribeToClaims(
    h: EventHandler<ClaimEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["ClaimEvent"], h, opts);
  }
  private async sub(
    names: ("DepositEvent" | "ResolutionEvent" | "ClaimEvent")[],
    h: EventHandler<never>,
    opts?: SubscribeOptions,
  ) {
    const off = await this.events.subscribe(names, h, opts?.fromSlot);
    return { stop: async () => off() };
  }

  /** QuickNode Streams webhook -> verified pipeline. */
  ingestStreams(signals: ArcStreamsSignal[]): void {
    this.events.ingest(signals.map((s) => s.txHash));
  }

  /** Run one sweep now (tests / after a webhook burst). */
  async sweepNow(): Promise<void> {
    await this.events.tick();
  }

  async stop(): Promise<void> {
    await this.events.stop();
  }

  // ------------------------------------------------------------------ relayer calls

  async markHedged(purchaseKey: string, opts?: SubmitOptions): Promise<TxReceipt> {
    const key = this.key(purchaseKey);
    return this.relayerTransition({
      fn: "markHedged",
      args: [key],
      opts,
      target: async () => {
        const u = await this.mustPurchase(key);
        return ["Hedged", "ClaimedByCustomer", "ClaimedByMerchant"].includes(u.state)
          ? true
          : u.state;
      },
      already: ["AlreadyHedged"],
      invalid: ["InvalidState", "PromoNotActive"],
      originalTx: () => this.findTx(HEDGE_MARKED, { purchase: key }),
    });
  }

  async cancelUnhedged(purchaseKey: string, opts?: SubmitOptions): Promise<TxReceipt> {
    const key = this.key(purchaseKey);
    return this.relayerTransition({
      fn: "cancelUnhedged",
      args: [key],
      opts,
      target: async () => {
        const u = await this.mustPurchase(key);
        return ["Cancelled", "Refunded"].includes(u.state) ? true : u.state;
      },
      already: ["AlreadyCancelled"],
      invalid: ["InvalidState"],
      originalTx: () => this.findTx(CANCELLED, { purchase: key }),
    });
  }

  async resolvePromotion(
    promoId: string,
    outcome: "YES" | "NO",
    opts?: SubmitOptions,
  ): Promise<TxReceipt> {
    const key = this.key(promoId);
    const want = outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
    try {
      return await this.relayerTransition({
        fn: "resolvePromo",
        args: [key, outcome === "YES" ? 0 : 1],
        opts,
        target: async () => {
          const p = await getPromoState(this.o.publicClient, this.o.escrow, key, "confirmed");
          if (!p) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `promo ${key} not found`);
          return p.state === want ? true : p.state;
        },
        already: ["AlreadyResolved"],
        invalid: [],
        originalTx: () => this.findTx(RESOLVED, { promo: key }),
      });
    } catch (e) {
      if (e instanceof ProgramFailure && e.errorName === "ResolutionTooEarly") {
        const p = await getPromoState(this.o.publicClient, this.o.escrow, key, "confirmed");
        throw new ResolutionTooEarlyError(p?.depositDeadline ?? 0);
      }
      throw e;
    }
  }

  /**
   * Shared idempotent flow: simulate+send; an "Already*" or a timeout re-reads state and returns
   * `alreadyApplied` when the target holds; a conflicting state is INVALID_STATE with the observed
   * state; transport problems are RPC_UNAVAILABLE (nothing sent) or TX_TIMEOUT (outcome unknown).
   */
  private async relayerTransition(t: {
    fn: "markHedged" | "cancelUnhedged" | "resolvePromo";
    args: readonly unknown[];
    opts?: SubmitOptions;
    target: () => Promise<true | string>;
    already: string[];
    invalid: string[];
    originalTx: () => Promise<{ hash: Hash; block: number } | null>;
  }): Promise<TxReceipt> {
    const commitment = t.opts?.commitment ?? this.commitment;
    try {
      const r = await submitRelayerCall({
        publicClient: this.o.publicClient,
        walletClient: this.o.walletClient,
        account: this.o.relayer,
        escrow: this.o.escrow,
        functionName: t.fn,
        args: t.args,
        commitment,
        timeoutMs: t.opts?.timeoutMs ?? this.timeoutMs,
      });
      const st = await t.target();
      if (st !== true)
        throw new GatewayInvalidStateError(
          `${t.fn} landed but state is ${st}`,
          st as OnChainPurchaseState,
          r.transactionHash,
        );
      return {
        signature: r.transactionHash,
        slot: Number(r.blockNumber),
        commitment,
        alreadyApplied: false,
      };
    } catch (e) {
      if (e instanceof SolanaGatewayError) throw e;
      if (e instanceof ProgramFailure) {
        const n = e.errorName ?? "";
        if (t.already.includes(n)) {
          const st = await t.target();
          if (st === true) {
            const orig = await t.originalTx();
            return {
              signature: orig?.hash ?? null,
              slot: orig?.block ?? null,
              commitment,
              alreadyApplied: true,
            };
          }
          throw new GatewayInvalidStateError(
            `${t.fn}: ${n} but state is ${st}`,
            st as OnChainPurchaseState,
          );
        }
        if (t.invalid.includes(n)) {
          const st = await t.target();
          throw new GatewayInvalidStateError(
            `${t.fn} rejected (${n}); observed ${st === true ? "target" : st}`,
            st === true ? null : (st as OnChainPurchaseState),
          );
        }
        if (n === "Paused")
          throw new SolanaGatewayError("PAUSED", `${t.fn}: program is paused`, e.txHash);
        if (n === "Unauthorized") {
          throw new SolanaGatewayError(
            "NOT_AUTHORIZED",
            `${t.fn}: ${this.o.relayer.address} is not the escrow's relayer`,
            e.txHash,
          );
        }
        if (n === "AccountNotFound")
          throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `${t.fn}: account not found`, e.txHash);
        if (n === "ResolutionTooEarly") throw e;
        throw new SolanaGatewayError("TX_FAILED", e.message, e.txHash);
      }
      if (e instanceof SubmitTimeout) {
        const st = await t.target().catch(() => "unknown");
        if (st === true)
          return { signature: e.txHash, slot: null, commitment, alreadyApplied: false };
        throw new SolanaGatewayError(
          "TX_TIMEOUT",
          `${t.fn} ${e.txHash}: outcome unknown (state ${st}); re-read and retry`,
          e.txHash,
        );
      }
      if (e instanceof RpcFailure) throw new SolanaGatewayError("RPC_UNAVAILABLE", e.message);
      throw new SolanaGatewayError(
        "RPC_UNAVAILABLE",
        (e as Error).message.split("\n")[0] ?? "rpc error",
      );
    }
  }

  // ------------------------------------------------------------------ reads

  async getConfig(): Promise<ArcConfig | null> {
    return getConfig(this.o.publicClient, this.o.escrow, this.commitment);
  }
  async getPromoState(promoId: string, commitment?: Commitment): Promise<ArcPromoAccount | null> {
    return getPromoState(
      this.o.publicClient,
      this.o.escrow,
      this.key(promoId),
      commitment ?? this.commitment,
    );
  }
  async getPurchaseState(
    purchaseKey: string,
    commitment?: Commitment,
  ): Promise<OnChainPurchaseAccount | null> {
    return getPurchaseState(
      this.o.publicClient,
      this.o.escrow,
      this.key(purchaseKey),
      commitment ?? this.commitment,
    );
  }
  async listPurchases(promoId: string, commitment?: Commitment): Promise<OnChainPurchaseAccount[]> {
    return listPurchases(
      this.o.publicClient,
      this.o.escrow,
      this.key(promoId),
      commitment ?? this.commitment,
    );
  }
  async verifyTransaction(txHash: string, commitment?: Commitment): Promise<TxVerification> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
      throw new SolanaGatewayError("VERIFICATION_FAILED", "not a tx hash");
    try {
      return await verifyArcTransaction(
        this.o.publicClient,
        this.o.escrow,
        this.o.token,
        txHash as Hash,
        commitment ?? this.commitment,
      );
    } catch (e) {
      if (e instanceof SolanaGatewayError) throw e;
      throw new SolanaGatewayError(
        "RPC_UNAVAILABLE",
        (e as Error).message.split("\n")[0] ?? "rpc error",
      );
    }
  }

  // ------------------------------------------------------------------ helpers

  private key(v: string): Hex {
    if (!isBytes32(v)) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `not a bytes32 id: ${v}`);
    return v;
  }

  private async mustPurchase(key: Hex): Promise<OnChainPurchaseAccount> {
    const u = await getPurchaseState(this.o.publicClient, this.o.escrow, key, "confirmed");
    if (!u) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `purchase ${key} not found`);
    return u;
  }

  /** Locate the original transition tx for an `alreadyApplied` receipt (best effort, recent window). */
  private async findTx(
    event: typeof HEDGE_MARKED | typeof CANCELLED | typeof RESOLVED,
    args: Record<string, Hex>,
  ): Promise<{ hash: Hash; block: number } | null> {
    try {
      const head = await this.o.publicClient.getBlockNumber();
      const from = head > 9_000n ? head - 9_000n : 0n;
      const logs = await this.o.publicClient.getLogs({
        address: this.o.escrow,
        event,
        args: args as never,
        fromBlock: from,
        toBlock: head,
      });
      const l = logs[0];
      return l?.transactionHash ? { hash: l.transactionHash, block: Number(l.blockNumber) } : null;
    } catch {
      return null;
    }
  }
}
