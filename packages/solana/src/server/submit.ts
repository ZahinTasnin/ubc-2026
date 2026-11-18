import type { Commitment as GwCommitment } from "@hedged/shared";
import {
  Connection,
  Transaction,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { extractProgramErrorCode } from "../errors";

/**
 * Relayer transaction submission: simulate (surface program errors early), send with
 * `skipPreflight`, rebroadcast until the commitment is reached, rebuild only on PROVEN blockhash
 * expiry. A program error is final for that attempt and is never blindly resent.
 */

export class ProgramFailure extends Error {
  constructor(
    readonly code: number | null,
    readonly logs: readonly string[],
    readonly signature?: string,
  ) {
    super(`program error ${code ?? "unknown"}`);
    this.name = "ProgramFailure";
  }
}
/** Sent, but no confirmation before the deadline: outcome UNKNOWN. */
export class SubmitTimeout extends Error {
  constructor(readonly signature: string | undefined) {
    super("transaction not confirmed before timeout");
    this.name = "SubmitTimeout";
  }
}
/** Never landed (blockhash expired) and out of time to rebuild. */
export class BlockhashExpired extends Error {
  constructor(readonly signature: string | undefined) {
    super("blockhash expired before the transaction landed");
    this.name = "BlockhashExpired";
  }
}
export class RpcFailure extends Error {
  constructor(readonly causeText: string) {
    super(`RPC unavailable: ${causeText}`);
    this.name = "RpcFailure";
  }
}

export interface SubmitResult {
  signature: string;
  slot: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function reached(status: string | null | undefined, want: GwCommitment): boolean {
  if (!status) return false;
  if (want === "confirmed") return status === "confirmed" || status === "finalized";
  return status === "finalized";
}

/** Heuristic: transport-level failures (fetch, 429, 5xx) vs anything else. */
export function isRpcError(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err);
  return /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket|network|429|50[0-9]|Too Many Requests|timed out/i.test(
    s,
  );
}

export async function submitRelayerInstruction(
  connection: Connection,
  ix: TransactionInstruction,
  signer: Keypair,
  opts: { commitment: GwCommitment; timeoutMs: number; pollMs?: number },
): Promise<SubmitResult> {
  const deadline = Date.now() + opts.timeoutMs;
  const pollMs = opts.pollMs ?? 500;
  let lastSig: string | undefined;
  let simulated = false;

  while (Date.now() < deadline) {
    let blockhash: string;
    let lastValidBlockHeight: number;
    try {
      ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
    } catch (e) {
      if (!isRpcError(e)) throw e;
      await sleep(pollMs);
      continue;
    }
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(
      ix,
    );
    tx.sign(signer);

    if (!simulated) {
      try {
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
          throw new ProgramFailure(
            extractProgramErrorCode(sim.value.err, sim.value.logs),
            sim.value.logs ?? [],
          );
        }
        simulated = true;
      } catch (e) {
        if (e instanceof ProgramFailure) throw e;
        if (!isRpcError(e)) throw e;
        await sleep(pollMs);
        continue;
      }
    }

    const raw = tx.serialize();
    const sig = tx.signatures[0]?.signature;
    if (!sig) throw new Error("transaction not signed");
    try {
      lastSig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e) {
      if (!isRpcError(e)) {
        const code = extractProgramErrorCode(e);
        throw new ProgramFailure(code, [], undefined);
      }
      await sleep(pollMs);
      continue;
    }

    let lastBroadcast = Date.now();
    let expired = false;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      let st;
      try {
        st = (await connection.getSignatureStatuses([lastSig])).value[0];
      } catch (e) {
        if (!isRpcError(e)) throw e;
        continue;
      }
      if (st?.err) {
        const t = await connection
          .getTransaction(lastSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
          .catch(() => null);
        throw new ProgramFailure(
          extractProgramErrorCode(st.err, t?.meta?.logMessages),
          t?.meta?.logMessages ?? [],
          lastSig,
        );
      }
      if (st && reached(st.confirmationStatus, opts.commitment)) {
        return { signature: lastSig, slot: st.slot };
      }
      if (!st) {
        // Not seen yet: has the blockhash expired? Only then is a rebuild safe.
        const height = await connection.getBlockHeight("confirmed").catch(() => null);
        if (height != null && height > lastValidBlockHeight) {
          expired = true;
          break;
        }
        if (Date.now() - lastBroadcast > 2000) {
          lastBroadcast = Date.now();
          await connection
            .sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })
            .catch(() => {});
        }
      }
    }
    if (!expired) throw new SubmitTimeout(lastSig);
  }
  if (lastSig) throw new BlockhashExpired(lastSig);
  throw new RpcFailure("no blockhash / send succeeded before the deadline");
}
