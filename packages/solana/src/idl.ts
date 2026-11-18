import { EventParser, Program, type Provider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
// Dev 2's committed IDL is the single source of truth (programs/escrow/idl). Never copy it here.
import idlJson from "../../../programs/escrow/idl/escrow.json";
import type { Escrow } from "../../../programs/escrow/idl/escrow";

export type { Escrow };

/** The raw Anchor IDL exactly as Dev 2 exported it. */
export const ESCROW_IDL = idlJson as unknown as Escrow;

/** Program ID baked into the IDL (`declare_id!`). */
export const ESCROW_PROGRAM_ID = new PublicKey(idlJson.address);

/**
 * Builder/decoder Program client. No wallet is attached: it only builds instructions, reads
 * accounts and decodes data, so it is safe in the browser. Signing happens in the wallet (Dev 1)
 * or in the server-only relayer module.
 */
export function createEscrowProgram(
  connection: Connection,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): Program<Escrow> {
  const idl = programId.equals(ESCROW_PROGRAM_ID)
    ? ESCROW_IDL
    : ({ ...ESCROW_IDL, address: programId.toBase58() } as Escrow);
  return new Program<Escrow>(idl, { connection } as Provider);
}

let decoder: Program<Escrow> | null = null;
/** Connection-free decoder (the Connection object is never used for RPC here). */
export function escrowDecoder(): Program<Escrow> {
  decoder ??= createEscrowProgram(new Connection("http://127.0.0.1:8899"));
  return decoder;
}

export function createEventParser(programId: PublicKey = ESCROW_PROGRAM_ID): EventParser {
  return new EventParser(programId, escrowDecoder().coder);
}
