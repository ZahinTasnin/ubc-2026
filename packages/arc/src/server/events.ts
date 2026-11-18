import {
  chainEventId,
  type Commitment,
  type EventHandler,
  type ProgramEvent,
  type TxVerification,
} from "@hedged/shared";
import { createPublicClient, webSocket, type Address, type Hash, type PublicClient } from "viem";
import { blockTagFor } from "../accounts";

/**
 * One verified-event pipeline fed by three signal sources (all at-least-once, deduped):
 *   - "poll": getLogs sweep from each subscriber's cursor up to the commitment head (always on;
 *     it is also the gap filler after restarts, dropped sockets or missed webhooks),
 *   - "websocket": eth_subscribe logs -> tx hashes (low latency),
 *   - "streams": QuickNode Streams webhook -> tx hashes (`ingest`).
 * A signal is only a tx hash: nothing reaches a handler before `verify(tx)` succeeded at the
 * configured commitment. Dedupe id: chainEventId = `${txHash}:${eventIndex}` (eventIndex = index
 * among the escrow's events in that tx). Handlers that throw are redelivered with backoff.
 * Arc has deterministic sub-second finality, so reorg handling = only consuming blocks at/below
 * the `finalized` head (plus re-verification of every tx).
 */
export type EventName = ProgramEvent["name"];

interface Sub {
  names: Set<EventName>;
  handler: EventHandler<never>;
  cursor: bigint; // last block fully swept for this subscriber
  seen: Set<string>;
  retry: Map<string, { ev: ProgramEvent; attempts: number; nextAt: number }>;
}

export interface ArcEventSourceOptions {
  client: PublicClient;
  escrow: Address;
  commitment: Commitment;
  verify: (tx: Hash) => Promise<TxVerification>;
  mode?: "poll" | "websocket" | "streams";
  wssUrl?: string;
  sweepMs?: number;
  /** Max blocks per getLogs call (public RPCs cap ranges). */
  maxRange?: bigint;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export class ArcEventSource {
  private subs: Sub[] = [];
  private timer: NodeJS.Timeout | null = null;
  private unwatch: (() => void) | null = null;
  private running = false;
  private ticking = false;
  private pendingSignals = new Map<Hash, number>(); // tx -> attempts (not yet at commitment / rpc error)

  constructor(private readonly o: ArcEventSourceOptions) {}

  async subscribe(
    names: EventName[],
    handler: EventHandler<never>,
    fromBlock?: number,
  ): Promise<() => void> {
    const head = await this.head();
    const sub: Sub = {
      names: new Set(names),
      handler,
      cursor: fromBlock !== undefined ? BigInt(Math.max(0, fromBlock - 1)) : head,
      seen: new Set(),
      retry: new Map(),
    };
    this.subs.push(sub);
    this.start();
    void this.tick();
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
    };
  }

  /** Streams / external signals: tx hashes to verify and deliver. */
  ingest(txHashes: Hash[]): void {
    for (const h of txHashes) this.pendingSignals.set(h, this.pendingSignals.get(h) ?? 0);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unwatch?.();
    this.unwatch = null;
    while (this.ticking) await new Promise((r) => setTimeout(r, 20));
  }

  private start() {
    if (this.running) return;
    this.running = true;
    const sweep = this.o.sweepMs ?? (this.o.mode === "streams" ? 15_000 : 2_000);
    this.timer = setInterval(() => void this.tick(), sweep);
    if (this.o.mode === "websocket" && this.o.wssUrl) {
      const ws = createPublicClient({ transport: webSocket(this.o.wssUrl) });
      this.unwatch = ws.watchEvent({
        address: this.o.escrow,
        onLogs: (logs) =>
          this.ingest(logs.map((l) => l.transactionHash).filter((h): h is Hash => Boolean(h))),
        onError: (e) =>
          this.o.log?.("websocket error (sweep continues)", { error: e.message.split("\n")[0] }),
      });
    }
  }

  private async head(): Promise<bigint> {
    const b = await this.o.client.getBlock({ blockTag: blockTagFor(this.o.commitment) });
    return b.number ?? 0n;
  }

  /** One pass: signals, then per-subscriber sweep, then retries. Never overlaps itself. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // 1. external signals
      for (const [h, attempts] of [...this.pendingSignals]) {
        try {
          const v = await this.o.verify(h);
          if (!v.confirmed) {
            if (attempts > 120)
              this.pendingSignals.delete(h); // sweep will still find it
            else this.pendingSignals.set(h, attempts + 1);
            continue;
          }
          this.pendingSignals.delete(h);
          for (const s of this.subs) await this.deliverAll(s, v);
        } catch (e) {
          this.o.log?.("signal verification failed", { tx: h, error: (e as Error).message });
          this.pendingSignals.delete(h);
        }
      }
      // 2. sweep
      const head = await this.head();
      for (const s of [...this.subs]) {
        const max = this.o.maxRange ?? 2_000n;
        while (s.cursor < head) {
          const from = s.cursor + 1n;
          const to = from + max - 1n < head ? from + max - 1n : head;
          const logs = await this.o.client.getLogs({
            address: this.o.escrow,
            fromBlock: from,
            toBlock: to,
          });
          const txs: Hash[] = [];
          for (const l of logs)
            if (l.transactionHash && !txs.includes(l.transactionHash)) txs.push(l.transactionHash);
          for (const h of txs) {
            try {
              const v = await this.o.verify(h);
              if (v.confirmed) await this.deliverAll(s, v);
            } catch (e) {
              this.o.log?.("verification failed (skipped)", { tx: h, error: (e as Error).message });
            }
          }
          s.cursor = to;
        }
      }
      // 3. retries
      const now = Date.now();
      for (const s of this.subs) {
        for (const [id, r] of [...s.retry]) {
          if (r.nextAt > now) continue;
          await this.deliverOne(s, id, r.ev, r.attempts);
        }
      }
    } catch (e) {
      this.o.log?.("event sweep error (will retry)", {
        error: (e as Error).message.split("\n")[0],
      });
    } finally {
      this.ticking = false;
    }
  }

  private async deliverAll(s: Sub, v: TxVerification) {
    for (const ev of v.events) {
      if (!s.names.has(ev.name)) continue;
      const id = chainEventId(ev);
      if (s.seen.has(id) || s.retry.has(id)) continue;
      await this.deliverOne(s, id, ev, 0);
    }
  }

  private async deliverOne(s: Sub, id: string, ev: ProgramEvent, attempts: number) {
    const { name: _name, ...payload } = ev;
    try {
      await (s.handler as EventHandler<unknown>)(payload);
      s.seen.add(id);
      s.retry.delete(id);
    } catch (e) {
      const delay = Math.min(60_000, 500 * 2 ** attempts);
      s.retry.set(id, { ev, attempts: attempts + 1, nextAt: Date.now() + delay });
      this.o.log?.("handler failed; will redeliver", {
        id,
        attempts: attempts + 1,
        error: (e as Error).message,
      });
    }
  }
}
