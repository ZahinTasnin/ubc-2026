import type { ChainPosition, Commitment, ProgramEvent, TxVerification } from "@hedged/shared";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { getPromoState, getPurchaseState } from "../accounts";
import { decodeEventsFromLogs, type RawProgramEvent } from "../codec";
import { reached } from "./submit";

/**
 * Independent verification of a transaction and its program events. Events are notifications,
 * not proof (docs/interfaces.md §3): an event is surfaced only if the transaction is found at
 * the requested commitment, succeeded, invoked the escrow program, and the token balances and
 * resulting account state agree with the payload.
 */

export interface VerifyContext {
  connection: Connection;
  programId: PublicKey;
  /** Config.mint (immutable); every vault/claim balance must be in this mint. */
  mint: string;
}

export interface VerifiedTx {
  verification: TxVerification;
  /** Human-readable reasons an event failed verification (empty = all good). */
  failures: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch the tx at `commitment`, waiting up to `waitMs` for it to get there. */
export async function fetchTransactionAt(
  connection: Connection,
  signature: string,
  commitment: Commitment,
  waitMs = 0,
  pollMs = 1500,
): Promise<VersionedTransactionResponse | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const tx = await connection.getTransaction(signature, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}

function accountKeys(tx: VersionedTransactionResponse): string[] {
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined,
  });
  const out: string[] = [];
  for (let i = 0; i < keys.length; i++) out.push(keys.get(i)!.toBase58());
  return out;
}

interface TokenDelta {
  account: string;
  owner: string | undefined;
  mint: string;
  delta: bigint;
}

function tokenDeltas(tx: VersionedTransactionResponse, keys: string[]): TokenDelta[] {
  const map = new Map<number, TokenDelta>();
  const touch = (
    b: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } },
    sign: 1n | -1n,
  ) => {
    const cur = map.get(b.accountIndex) ?? {
      account: keys[b.accountIndex] ?? "?",
      owner: b.owner,
      mint: b.mint,
      delta: 0n,
    };
    cur.delta += sign * BigInt(b.uiTokenAmount.amount);
    cur.owner ??= b.owner;
    map.set(b.accountIndex, cur);
  };
  for (const b of tx.meta?.preTokenBalances ?? []) touch(b, -1n);
  for (const b of tx.meta?.postTokenBalances ?? []) touch(b, 1n);
  return [...map.values()];
}

export async function verifySignature(
  ctx: VerifyContext,
  signature: string,
  commitment: Commitment,
  waitMs = 0,
): Promise<VerifiedTx> {
  const empty = (over: Partial<TxVerification>): VerifiedTx => ({
    verification: {
      signature,
      confirmed: false,
      commitment: null,
      slot: null,
      err: null,
      events: [],
      ...over,
    },
    failures: [],
  });

  const tx = await fetchTransactionAt(ctx.connection, signature, commitment, waitMs);
  if (!tx) return empty({});
  if (tx.meta?.err) {
    return empty({ slot: tx.slot, err: JSON.stringify(tx.meta.err), commitment });
  }
  // getTransaction(commitment) only returns txs at that level; double-check via status.
  const st = (
    await ctx.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
  ).value[0];
  const level: Commitment =
    st?.confirmationStatus === "finalized"
      ? "finalized"
      : reached(st?.confirmationStatus, "confirmed")
        ? "confirmed"
        : commitment;
  if (!reached(level, commitment)) return empty({ slot: tx.slot });

  const keys = accountKeys(tx);
  const programId = ctx.programId.toBase58();
  if (!keys.includes(programId)) {
    return { ...empty({ confirmed: true, commitment: level, slot: tx.slot }), failures: [] };
  }

  const decoded = decodeEventsFromLogs(tx.meta?.logMessages ?? [], ctx.programId);
  const deltas = tokenDeltas(tx, keys);
  const failures: string[] = [];
  const events: ProgramEvent[] = [];

  // Vault conservation for this tx: net vault delta == Σ deposits − Σ claims, per vault.
  const vaultExpect = new Map<string, bigint>();
  const vaultOf = new Map<string, string>();
  const vaultFor = async (promo: string) => {
    if (!vaultOf.has(promo)) {
      const p = await getPromoState(ctx.connection, promo, {
        programId: ctx.programId,
        commitment,
      });
      vaultOf.set(promo, p?.vault ?? "");
    }
    return vaultOf.get(promo)!;
  };

  for (const { eventIndex, event } of decoded) {
    const pos: ChainPosition = {
      signature,
      eventIndex,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      commitment: level,
    };
    const fail = (why: string) => failures.push(`${event.name}#${eventIndex}: ${why}`);
    const ok = await checkEvent(ctx, event, commitment, deltas, fail);
    if ("promo" in event && (event.name === "DepositEvent" || event.name === "ClaimEvent")) {
      const vault = await vaultFor(event.promo);
      const sign = event.name === "DepositEvent" ? 1n : -1n;
      vaultExpect.set(vault, (vaultExpect.get(vault) ?? 0n) + sign * BigInt(event.amount));
    }
    if (ok) events.push({ ...event, ...pos } as ProgramEvent);
  }
  for (const [vault, expected] of vaultExpect) {
    const d = deltas.find((x) => x.account === vault);
    if ((d?.delta ?? 0n) !== expected) {
      failures.push(`vault ${vault} moved ${d?.delta ?? 0n}, events say ${expected}`);
    }
    if (d && d.mint !== ctx.mint) failures.push(`vault ${vault} mint ${d.mint} != config mint`);
  }

  return {
    verification: {
      signature,
      confirmed: true,
      commitment: level,
      slot: tx.slot,
      err: null,
      events: failures.length ? [] : events,
    },
    failures,
  };
}

/** Per-event account/token-state agreement. Returns true when the event checks out. */
async function checkEvent(
  ctx: VerifyContext,
  e: RawProgramEvent,
  commitment: Commitment,
  deltas: TokenDelta[],
  fail: (why: string) => void,
): Promise<boolean> {
  const opts = { programId: ctx.programId, commitment };
  switch (e.name) {
    case "DepositEvent": {
      const p = await getPurchaseState(ctx.connection, e.purchase, opts);
      if (!p) return (fail("purchase account missing"), false);
      if (p.promoPda !== e.promo || p.customer !== e.customer)
        return (fail("purchase owner mismatch"), false);
      if (p.purchaseId !== e.purchaseId || p.amount !== e.amount)
        return (fail("purchase fields mismatch"), false);
      const src = deltas.find((d) => d.owner === e.customer && d.mint === ctx.mint && d.delta < 0n);
      if (!src || -src.delta < BigInt(e.amount))
        return (fail("customer token debit not found"), false);
      return true;
    }
    case "HedgeMarkedEvent": {
      const p = await getPurchaseState(ctx.connection, e.purchase, opts);
      if (!p || p.promoPda !== e.promo) return (fail("purchase missing/mismatch"), false);
      if (p.state === "Deposited" || p.state === "Cancelled" || p.state === "Refunded") {
        return (fail(`purchase is ${p.state}, not hedged`), false);
      }
      return true;
    }
    case "PurchaseCancelledEvent": {
      const p = await getPurchaseState(ctx.connection, e.purchase, opts);
      if (!p || p.promoPda !== e.promo || p.customer !== e.customer)
        return (fail("purchase mismatch"), false);
      if (p.state !== "Cancelled" && p.state !== "Refunded")
        return (fail(`purchase is ${p.state}`), false);
      return true;
    }
    case "ResolutionEvent": {
      const pr = await getPromoState(ctx.connection, e.promo, opts);
      const want = e.outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
      if (!pr || pr.state !== want) return (fail(`promo state ${pr?.state} != ${want}`), false);
      return true;
    }
    case "ClaimEvent": {
      const p = await getPurchaseState(ctx.connection, e.purchase, opts);
      if (!p || p.promoPda !== e.promo) return (fail("purchase mismatch"), false);
      const terminal =
        e.kind === "CANCEL_REFUND"
          ? "Refunded"
          : e.kind === "YES_REFUND"
            ? "ClaimedByCustomer"
            : "ClaimedByMerchant";
      if (p.state !== terminal)
        return (fail(`purchase is ${p.state}, expected ${terminal}`), false);
      const credit = deltas.find(
        (d) => d.owner === e.recipient && d.mint === ctx.mint && d.delta > 0n,
      );
      if (!credit || credit.delta < BigInt(e.amount))
        return (fail("recipient credit not found"), false);
      return true;
    }
  }
}
