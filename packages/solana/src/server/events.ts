import {
  chainEventId,
  type Commitment,
  type EventHandler,
  type ProgramEvent,
  type SubscribeOptions,
  type Unsubscribe,
} from "@hedged/shared";
import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { verifySignature, type VerifyContext } from "./verify";

/**
 * Program event pipeline shared by the three gateway subscriptions.
 *
 * Signal sources (any mix, all funnel into one verify-then-dispatch queue):
 *  - QuickNode Streams webhook pushes (`ingestSignatures`, primary source in "streams" mode)
 *  - WebSocket `logsSubscribe` on the program (primary in "websocket" mode)
 *  - an RPC sweep with `getSignaturesForAddress` (gap filler: dropped sockets, restarts)
 * Replay: a subscriber's `fromSlot` triggers a backfill of every program tx with slot >= fromSlot.
 *
 * Guarantees: verified events only (verify.ts), at the configured commitment; at-least-once;
 * per-subscriber dedupe by `chainEventId`; a handler that throws is redelivered with backoff
 * and holds back later events for that subscriber (ack = handler resolves).
 */

export type EventName = ProgramEvent["name"];
type Log = (msg: string, extra?: Record<string, unknown>) => void;

export interface EventSourceOptions {
  connection: Connection;
  programId: PublicKey;
  commitment: Commitment;
  /** Config.mint; resolved lazily by the gateway. */
  getMint: () => Promise<string>;
  /** "websocket": logsSubscribe + sweep. "streams": QuickNode Streams webhook + slow sweep. */
  mode: "websocket" | "streams";
  /** RPC sweep interval. Default 5 s (websocket) / 30 s (streams). 0 disables. */
  sweepMs?: number;
  /** How long to wait for a seen signature to reach the commitment. Default 90 s. */
  finalityWaitMs?: number;
  log?: Log;
}

interface Subscriber {
  names: Set<EventName>;
  handler: EventHandler<ProgramEvent>;
  delivered: Set<string>;
  queue: ProgramEvent[];
  draining: boolean;
  stopped: boolean;
  /** Only events at or after this slot (inclusive: same-slot events are deduped). */
  fromSlot: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_DEDUPE = 20_000;

export class ProgramEventSource {
  private readonly subs = new Set<Subscriber>();
  private readonly seenSigs = new Map<string, number>(); // signature -> slot, verified+dispatched
  private readonly inflight = new Map<string, Promise<boolean>>();
  private wsId: number | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  /** Newest signature the sweep has processed (its `until` cursor). */
  private cursor: string | undefined;
  private started = false;
  readonly stats = {
    verified: 0,
    rejected: 0,
    delivered: 0,
    redelivered: 0,
    viaStreams: 0,
    viaWs: 0,
    viaSweep: 0,
  };

  constructor(private readonly o: EventSourceOptions) {}

  private log(msg: string, extra?: Record<string, unknown>) {
    this.o.log?.(msg, extra);
  }

  async subscribe(
    names: EventName[],
    handler: EventHandler<ProgramEvent>,
    opts: SubscribeOptions = {},
  ): Promise<Unsubscribe> {
    const sub: Subscriber = {
      names: new Set(names),
      handler,
      delivered: new Set(),
      queue: [],
      draining: false,
      stopped: false,
      fromSlot: opts.fromSlot ?? 0,
    };
    this.subs.add(sub);
    if (!this.started) await this.start();
    // Live events flow immediately; the backfill only adds older ones (dedupe absorbs overlap).
    if (opts.fromSlot != null) await this.backfill(sub, opts.fromSlot);
    return {
      stop: async () => {
        sub.stopped = true;
        this.subs.delete(sub);
        if (this.subs.size === 0) await this.stop();
      },
    };
  }

  /** Feed signatures from an external push source (QuickNode Streams webhook). */
  async ingestSignatures(
    items: { signature: string; slot?: number }[],
    via: "streams" | "ws" = "streams",
  ) {
    const done = await Promise.all(items.map((i) => this.process(i.signature, via)));
    return { accepted: items.length, settled: done.filter(Boolean).length };
  }

  private async start() {
    this.started = true;
    // Start the sweep cursor at the current tip so live processing does not rescan history.
    const latest = await this.o.connection
      .getSignaturesForAddress(this.o.programId, { limit: 1 }, "confirmed")
      .catch(() => []);
    this.cursor = latest[0]?.signature;
    if (this.o.mode === "websocket") {
      this.wsId = this.o.connection.onLogs(
        this.o.programId,
        (l) => {
          if (!l.err) void this.process(l.signature, "ws");
        },
        "confirmed",
      );
    }
    const sweepMs = this.o.sweepMs ?? (this.o.mode === "streams" ? 30_000 : 5_000);
    if (sweepMs > 0) this.sweepTimer = setInterval(() => void this.sweep(), sweepMs);
  }

  async stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.wsId != null) await this.o.connection.removeOnLogsListener(this.wsId).catch(() => {});
    this.wsId = null;
    this.started = false;
    await Promise.allSettled([...this.inflight.values()]);
  }

  /** One sweep: every program signature newer than the cursor, oldest first. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const fresh: ConfirmedSignatureInfo[] = [];
      let before: string | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await this.o.connection.getSignaturesForAddress(
          this.o.programId,
          { until: this.cursor, before, limit: 1000 },
          "confirmed",
        );
        fresh.push(...batch);
        if (batch.length < 1000) break;
        before = batch[batch.length - 1]!.signature;
      }
      if (fresh.length === 0) return;
      // Oldest first. The cursor only advances past signatures that settled, so a tx that has
      // not reached the commitment yet is picked up again by the next sweep.
      for (const s of fresh.reverse()) {
        const done = s.err ? true : await this.process(s.signature, "sweep");
        if (!done) break;
        this.cursor = s.signature;
      }
    } catch (e) {
      this.log("sweep failed (will retry)", { err: String(e) });
    } finally {
      this.sweeping = false;
    }
  }

  /** Replay every program tx with slot >= fromSlot to ONE subscriber, oldest first. */
  private async backfill(sub: Subscriber, fromSlot: number) {
    const all: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      const batch = await this.o.connection.getSignaturesForAddress(
        this.o.programId,
        { before, limit: 1000 },
        "confirmed",
      );
      const inRange = batch.filter((b) => b.slot >= fromSlot);
      all.push(...inRange);
      if (batch.length < 1000 || inRange.length < batch.length) break;
      before = batch[batch.length - 1]!.signature;
    }
    this.log("backfill", { fromSlot, transactions: all.length });
    for (const s of all.reverse()) {
      if (s.err) continue;
      const v = await this.verify(s.signature);
      if (v) this.enqueue(sub, v, true);
    }
  }

  private async verify(signature: string): Promise<ProgramEvent[] | null> {
    const ctx: VerifyContext = {
      connection: this.o.connection,
      programId: this.o.programId,
      mint: await this.o.getMint(),
    };
    const res = await verifySignature(
      ctx,
      signature,
      this.o.commitment,
      this.o.finalityWaitMs ?? 90_000,
    );
    if (!res.verification.confirmed) {
      if (res.verification.err) return []; // failed tx: no events, nothing to retry
      return null; // never reached the commitment in time: the sweep will see it again
    }
    if (res.failures.length) {
      this.stats.rejected++;
      this.log("VERIFICATION_FAILED: events dropped", { signature, failures: res.failures });
      return [];
    }
    this.stats.verified++;
    return res.verification.events;
  }

  /** Verify + dispatch one signature. Resolves true once settled (dispatched or rejected). */
  private process(signature: string, via: "streams" | "ws" | "sweep"): Promise<boolean> {
    if (this.seenSigs.has(signature)) return Promise.resolve(true);
    const existing = this.inflight.get(signature);
    if (existing) return existing;
    if (via === "streams") this.stats.viaStreams++;
    else if (via === "ws") this.stats.viaWs++;
    else this.stats.viaSweep++;
    const p = (async () => {
      try {
        const events = await this.verify(signature);
        if (events == null) return false; // not final yet; leave unseen so a later signal retries
        const slot = events[0]?.slot ?? 0;
        this.seenSigs.set(signature, slot);
        if (this.seenSigs.size > MAX_DEDUPE)
          this.seenSigs.delete(this.seenSigs.keys().next().value!);
        for (const sub of this.subs) this.enqueueAll(sub, events);
        return true;
      } catch (e) {
        this.log("process failed (will retry on next signal)", { signature, err: String(e) });
        return false;
      } finally {
        this.inflight.delete(signature);
      }
    })();
    this.inflight.set(signature, p);
    return p;
  }

  private enqueueAll(sub: Subscriber, events: ProgramEvent[]) {
    this.enqueue(sub, events, false);
  }

  private enqueue(sub: Subscriber, events: ProgramEvent[], replay: boolean) {
    for (const e of events) {
      if (!sub.names.has(e.name)) continue;
      if (!replay && e.slot < sub.fromSlot) continue;
      const id = chainEventId(e);
      if (sub.delivered.has(id) || sub.queue.some((q) => chainEventId(q) === id)) continue;
      sub.queue.push(e);
    }
    void this.drain(sub);
  }

  private async drain(sub: Subscriber) {
    if (sub.draining) return;
    sub.draining = true;
    try {
      while (sub.queue.length && !sub.stopped) {
        const e = sub.queue[0]!;
        let attempt = 0;
        for (;;) {
          try {
            await sub.handler(e);
            break;
          } catch (err) {
            if (sub.stopped) return;
            attempt++;
            this.stats.redelivered++;
            const delay = Math.min(30_000, 250 * 2 ** Math.min(attempt, 7)) * (0.5 + Math.random());
            this.log("handler threw; redelivering", {
              id: chainEventId(e),
              attempt,
              err: String(err),
            });
            await sleep(delay);
          }
        }
        sub.queue.shift();
        sub.delivered.add(chainEventId(e));
        if (sub.delivered.size > MAX_DEDUPE)
          sub.delivered.delete(sub.delivered.values().next().value!);
        this.stats.delivered++;
      }
    } finally {
      sub.draining = false;
    }
  }
}
