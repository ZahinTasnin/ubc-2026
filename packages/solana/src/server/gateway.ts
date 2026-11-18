import {
  SolanaGatewayError,
  type Base58,
  type ClaimEvent,
  type Commitment,
  type DepositEvent,
  type EventHandler,
  type GatewayErrorCode,
  type OnChainPurchaseAccount,
  type OnChainPurchaseState,
  type ProgramEvent,
  type ResolutionEvent,
  type SolanaServerGateway,
  type SubmitOptions,
  type SubscribeOptions,
  type TxReceipt,
  type TxVerification,
  type Unsubscribe,
} from "@hedged/shared";
import { Connection, PublicKey, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { getConfigAccount, getPromoState, getPurchaseState, listPurchases } from "../accounts";
import { decodeEventsFromLogs, type ConfigAccount, type PromoAccount } from "../codec";
import { ANCHOR_ACCOUNT_NOT_INITIALIZED, ESCROW_ERRORS as E, escrowErrorName } from "../errors";
import { createEscrowProgram, ESCROW_PROGRAM_ID } from "../idl";
import { deriveConfigPda } from "../pda";
import { ProgramEventSource, type EventSourceOptions } from "./events";
import { type StreamsSignal } from "./streams";
import {
  BlockhashExpired,
  ProgramFailure,
  RpcFailure,
  SubmitTimeout,
  isRpcError,
  submitRelayerInstruction,
} from "./submit";
import { verifySignature } from "./verify";

/**
 * Real Devnet implementation of `SolanaServerGateway` (docs/interfaces.md §4). SERVER ONLY:
 * holds the relayer key. Dev 4 depends only on the interface; this class adds `ingestStreams`
 * (QuickNode Streams webhook) and `stop()` for the host process.
 */

export interface RealGatewayOptions {
  connection: Connection;
  relayer: Keypair;
  programId?: PublicKey;
  /** MVP default "finalized" (env SOLANA_FINALITY). */
  commitment?: Commitment;
  /** Default budget for privileged calls incl. resend-safe retries. Default 90 s. */
  timeoutMs?: number;
  /** Event delivery source; default "websocket". */
  eventSource?: EventSourceOptions["mode"];
  sweepMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/** INVALID_STATE carrying the on-chain state the gateway observed (INTEGRATION.md §6). */
export class GatewayInvalidStateError extends SolanaGatewayError {
  constructor(
    message: string,
    readonly observedState: OnChainPurchaseState | PromoAccount["state"] | null,
    signature?: Base58,
  ) {
    super("INVALID_STATE", message, signature);
    this.name = "GatewayInvalidStateError";
  }
}

/**
 * `resolve_promo` before `Promo.depositDeadline` (6020). Not alreadyApplied, not INVALID_STATE:
 * retryable once the deadline passes (INTEGRATION.md "resolve_promo precondition").
 */
export class ResolutionTooEarlyError extends SolanaGatewayError {
  constructor(readonly retryAfterUnix: number) {
    super("TX_FAILED", `ResolutionTooEarly: retry at/after ${retryAfterUnix}`);
    this.name = "ResolutionTooEarlyError";
    Object.defineProperty(this, "retryable", { value: true });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RealSolanaGateway implements SolanaServerGateway {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly relayerPublicKey: Base58;
  private readonly relayer: Keypair;
  private readonly timeoutMs: number;
  private readonly events: ProgramEventSource;
  private mint: string | null = null;
  private readonly log: NonNullable<RealGatewayOptions["log"]>;

  constructor(o: RealGatewayOptions) {
    this.connection = o.connection;
    this.programId = o.programId ?? ESCROW_PROGRAM_ID;
    this.commitment = o.commitment ?? "finalized";
    this.relayer = o.relayer;
    this.relayerPublicKey = o.relayer.publicKey.toBase58();
    this.timeoutMs = o.timeoutMs ?? 90_000;
    this.log = o.log ?? (() => {});
    this.events = new ProgramEventSource({
      connection: this.connection,
      programId: this.programId,
      commitment: this.commitment,
      getMint: () => this.getMint(),
      mode: o.eventSource ?? "websocket",
      sweepMs: o.sweepMs,
      log: this.log,
    });
  }

  // ---- subscriptions -------------------------------------------------------------------------

  subscribeToDeposits(
    h: EventHandler<DepositEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.events.subscribe(["DepositEvent"], strip(h), opts);
  }
  subscribeToResolutions(
    h: EventHandler<ResolutionEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.events.subscribe(["ResolutionEvent"], strip(h), opts);
  }
  subscribeToClaims(h: EventHandler<ClaimEvent>, opts?: SubscribeOptions): Promise<Unsubscribe> {
    return this.events.subscribe(["ClaimEvent"], strip(h), opts);
  }

  /** QuickNode Streams webhook signals (see streams.ts). Fire-and-forget; verification follows. */
  ingestStreams(signals: StreamsSignal[]): void {
    void this.events.ingestSignatures(signals, "streams");
  }

  /** One RPC sweep now (tests / ops). */
  sweepNow(): Promise<void> {
    return this.events.sweep();
  }

  get eventStats() {
    return { ...this.events.stats };
  }

  async stop(): Promise<void> {
    await this.events.stop();
  }

  // ---- privileged (relayer-signed) -----------------------------------------------------------

  async markHedged(purchasePda: Base58, opts?: SubmitOptions): Promise<TxReceipt> {
    return this.purchaseTransition(purchasePda, "markHedged", "Hedged", opts);
  }

  async cancelUnhedged(purchasePda: Base58, opts?: SubmitOptions): Promise<TxReceipt> {
    return this.purchaseTransition(purchasePda, "cancelUnhedged", "Cancelled", opts);
  }

  async resolvePromotion(
    promoPda: Base58,
    outcome: "YES" | "NO",
    opts?: SubmitOptions,
  ): Promise<TxReceipt> {
    const commitment = opts?.commitment ?? this.commitment;
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const want = outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
    const read = (c: Commitment) => this.rpc(() => this.getPromoState(promoPda, c));

    const pre = await read("confirmed");
    if (!pre) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `promo ${promoPda} not found`);
    if (pre.state === want)
      return this.already(
        read,
        (p) => p?.state === want,
        commitment,
        timeoutMs,
        promoPda,
        "ResolutionEvent",
      );
    if (pre.state !== "Active") {
      throw new GatewayInvalidStateError(`promo already ${pre.state}; refusing ${want}`, pre.state);
    }

    const ix = await createEscrowProgram(this.connection, this.programId)
      .methods.resolvePromo(outcome === "YES" ? { yes: {} } : { no: {} })
      .accountsStrict({
        relayer: this.relayer.publicKey,
        config: this.configPda(),
        promo: new PublicKey(promoPda),
      })
      .instruction();

    try {
      const r = await submitRelayerInstruction(this.connection, ix, this.relayer, {
        commitment,
        timeoutMs,
      });
      const after = await read(commitment);
      if (after?.state !== want) {
        throw new SolanaGatewayError(
          "VERIFICATION_FAILED",
          `landed but promo is ${after?.state}`,
          r.signature,
        );
      }
      return { signature: r.signature, slot: r.slot, commitment, alreadyApplied: false };
    } catch (e) {
      if (e instanceof ProgramFailure) {
        if (e.code === E.ResolutionTooEarly) throw new ResolutionTooEarlyError(pre.depositDeadline);
        if (e.code === E.AlreadyResolved) {
          const now = await read(commitment);
          if (now?.state === want) {
            return { signature: null, slot: null, commitment, alreadyApplied: true };
          }
          throw new GatewayInvalidStateError(
            `conflicting outcome: promo is ${now?.state}`,
            now?.state ?? null,
          );
        }
        throw this.mapProgramFailure(e);
      }
      return this.afterUncertain(e, read, (p) => p?.state === want, commitment);
    }
  }

  private async purchaseTransition(
    purchasePda: Base58,
    method: "markHedged" | "cancelUnhedged",
    target: "Hedged" | "Cancelled",
    opts?: SubmitOptions,
  ): Promise<TxReceipt> {
    const commitment = opts?.commitment ?? this.commitment;
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const read = (c: Commitment) => this.rpc(() => this.getPurchaseState(purchasePda, c));
    const isTarget = (p: OnChainPurchaseAccount | null) =>
      // A cancelled purchase that the customer already refunded still satisfies "cancelled".
      p?.state === target || (target === "Cancelled" && p?.state === "Refunded");

    const pre = await read("confirmed");
    if (!pre)
      throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `purchase ${purchasePda} not found`);
    if (isTarget(pre)) {
      return this.already(
        read,
        isTarget,
        commitment,
        timeoutMs,
        purchasePda,
        target === "Hedged" ? "HedgeMarkedEvent" : "PurchaseCancelledEvent",
      );
    }
    if (pre.state !== "Deposited") {
      throw new GatewayInvalidStateError(`cannot ${method} a ${pre.state} purchase`, pre.state);
    }

    const program = createEscrowProgram(this.connection, this.programId);
    const accounts = {
      relayer: this.relayer.publicKey,
      config: this.configPda(),
      promo: new PublicKey(pre.promoPda),
      purchase: new PublicKey(purchasePda),
    };
    const ix: TransactionInstruction =
      method === "markHedged"
        ? await program.methods.markHedged().accountsStrict(accounts).instruction()
        : await program.methods.cancelUnhedged().accountsStrict(accounts).instruction();

    try {
      const r = await submitRelayerInstruction(this.connection, ix, this.relayer, {
        commitment,
        timeoutMs,
      });
      const after = await read(commitment);
      if (!isTarget(after)) {
        throw new SolanaGatewayError(
          "VERIFICATION_FAILED",
          `landed but purchase is ${after?.state}`,
          r.signature,
        );
      }
      return { signature: r.signature, slot: r.slot, commitment, alreadyApplied: false };
    } catch (e) {
      if (e instanceof ProgramFailure) {
        const already = method === "markHedged" ? E.AlreadyHedged : E.AlreadyCancelled;
        if (e.code === already || e.code === E.InvalidState || e.code === E.PromoNotActive) {
          // Decide from state, never from the error alone (INTEGRATION.md §5, §6).
          const now = await read(commitment);
          if (isTarget(now))
            return { signature: null, slot: null, commitment, alreadyApplied: true };
          throw new GatewayInvalidStateError(
            `${method} rejected (${escrowErrorName(e.code!) ?? e.code}); purchase is ${now?.state}`,
            now?.state ?? null,
            e.signature,
          );
        }
        throw this.mapProgramFailure(e);
      }
      return this.afterUncertain(e, read, isTarget, commitment);
    }
  }

  /** Target state already holds: wait until it is visible at `commitment`, find the original tx. */
  private async already<T>(
    read: (c: Commitment) => Promise<T>,
    ok: (v: T) => boolean,
    commitment: Commitment,
    timeoutMs: number,
    address: Base58,
    eventName: string,
  ): Promise<TxReceipt> {
    const deadline = Date.now() + timeoutMs;
    while (!ok(await read(commitment))) {
      if (Date.now() > deadline) {
        throw new SolanaGatewayError(
          "TX_TIMEOUT",
          `state visible at confirmed but not yet ${commitment}`,
        );
      }
      await sleep(1000);
    }
    const original = await this.findOriginal(address, eventName, commitment).catch(() => null);
    return {
      signature: original?.signature ?? null,
      slot: original?.slot ?? null,
      commitment,
      alreadyApplied: true,
    };
  }

  /** Best effort: the tx that emitted `eventName` for `address` (recent history only). */
  private async findOriginal(address: Base58, eventName: string, commitment: Commitment) {
    const sigs = await this.connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 25 },
      commitment,
    );
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await this.connection.getTransaction(s.signature, {
        commitment,
        maxSupportedTransactionVersion: 0,
      });
      const evs = decodeEventsFromLogs(tx?.meta?.logMessages ?? [], this.programId);
      const hit = evs.find(
        ({ event }) =>
          event.name === eventName &&
          (("purchase" in event && event.purchase === address) || event.promo === address),
      );
      if (hit) return { signature: s.signature, slot: s.slot };
    }
    return null;
  }

  /** Timeout / RPC failure / expiry: outcome unknown → re-read state before deciding. */
  private async afterUncertain<T>(
    e: unknown,
    read: (c: Commitment) => Promise<T>,
    ok: (v: T) => boolean,
    commitment: Commitment,
  ): Promise<TxReceipt> {
    const signature =
      e instanceof SubmitTimeout || e instanceof BlockhashExpired ? e.signature : undefined;
    const now = await read(commitment).catch(() => null as T);
    if (now != null && ok(now)) {
      return { signature: signature ?? null, slot: null, commitment, alreadyApplied: false };
    }
    if (e instanceof SolanaGatewayError) throw e;
    if (e instanceof SubmitTimeout)
      throw new SolanaGatewayError("TX_TIMEOUT", e.message, signature);
    if (e instanceof BlockhashExpired)
      throw new SolanaGatewayError("BLOCKHASH_EXPIRED", e.message, signature);
    if (e instanceof RpcFailure || isRpcError(e))
      throw new SolanaGatewayError("RPC_UNAVAILABLE", String(e));
    throw new SolanaGatewayError("TX_FAILED", String((e as Error)?.message ?? e), signature);
  }

  private mapProgramFailure(e: ProgramFailure): SolanaGatewayError {
    const name = e.code != null ? (escrowErrorName(e.code) ?? `code ${e.code}`) : "unknown";
    const code: GatewayErrorCode =
      e.code === E.Paused
        ? "PAUSED"
        : e.code === E.Unauthorized
          ? "NOT_AUTHORIZED"
          : e.code === ANCHOR_ACCOUNT_NOT_INITIALIZED
            ? "ACCOUNT_NOT_FOUND"
            : "TX_FAILED";
    return new SolanaGatewayError(code, `program rejected: ${name}`, e.signature);
  }

  // ---- reads -------------------------------------------------------------------------------

  async getConfig(): Promise<ConfigAccount | null> {
    return this.rpc(() => getConfigAccount(this.connection, this.programId, this.commitment));
  }

  async getPromoState(promoPda: Base58, commitment?: Commitment): Promise<PromoAccount | null> {
    return this.rpc(() =>
      getPromoState(this.connection, promoPda, {
        programId: this.programId,
        commitment: commitment ?? this.commitment,
      }),
    );
  }

  async getPurchaseState(
    purchasePda: Base58,
    commitment?: Commitment,
  ): Promise<OnChainPurchaseAccount | null> {
    return this.rpc(() =>
      getPurchaseState(this.connection, purchasePda, {
        programId: this.programId,
        commitment: commitment ?? this.commitment,
      }),
    );
  }

  async listPurchases(
    promoPda: Base58,
    commitment?: Commitment,
  ): Promise<OnChainPurchaseAccount[]> {
    return this.rpc(() =>
      listPurchases(this.connection, promoPda, {
        programId: this.programId,
        commitment: commitment ?? this.commitment,
      }),
    );
  }

  async verifyTransaction(signature: Base58, commitment?: Commitment): Promise<TxVerification> {
    const res = await this.rpc(async () =>
      verifySignature(
        { connection: this.connection, programId: this.programId, mint: await this.getMint() },
        signature,
        commitment ?? this.commitment,
      ),
    );
    if (res.failures.length) {
      throw new SolanaGatewayError("VERIFICATION_FAILED", res.failures.join("; "), signature);
    }
    return res.verification;
  }

  // ---- helpers -----------------------------------------------------------------------------

  private configPda(): PublicKey {
    return new PublicKey(deriveConfigPda(this.programId.toBase58()).address);
  }

  private async getMint(): Promise<string> {
    if (this.mint) return this.mint;
    const cfg = await getConfigAccount(this.connection, this.programId, "confirmed");
    if (!cfg) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", "escrow Config not initialized");
    this.mint = cfg.mint; // immutable on-chain
    return this.mint;
  }

  /** Map transport failures of reads to RPC_UNAVAILABLE (retryable). */
  private async rpc<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SolanaGatewayError) throw e;
      if (isRpcError(e))
        throw new SolanaGatewayError("RPC_UNAVAILABLE", String((e as Error).message ?? e));
      throw e;
    }
  }
}

/** Deliver the plain shared event type: drop the union's internal `name` tag. */
function strip<T>(h: EventHandler<T>): EventHandler<ProgramEvent> {
  return (e) => {
    const { name: _name, ...rest } = e;
    return h(rest as T);
  };
}
