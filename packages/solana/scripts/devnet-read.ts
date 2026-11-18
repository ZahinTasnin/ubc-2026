/**
 * Read-only Devnet check (no keys needed): `pnpm --filter @hedged/solana devnet:read [promoPda]`.
 * Prints the escrow Config (admin, relayer, mint, paused, timeout), the program's recent activity,
 * and optionally one promotion with its purchases. Uses QUICKNODE_RPC_URL / SOLANA_RPC_URL if set.
 */
import { Connection } from "@solana/web3.js";
import {
  DEVNET_GENESIS_HASH,
  ESCROW_PROGRAM_ID,
  PUBLIC_DEVNET_RPC,
  deriveConfigPda,
  getConfigAccount,
  getPromoState,
  listPurchases,
  redactRpcUrl,
} from "../src/index";

const url = process.env.QUICKNODE_RPC_URL || process.env.SOLANA_RPC_URL || PUBLIC_DEVNET_RPC;
const connection = new Connection(url, "confirmed");

const genesis = await connection.getGenesisHash();
console.log(
  "rpc       ",
  redactRpcUrl(url),
  genesis === DEVNET_GENESIS_HASH ? "(devnet)" : `(genesis ${genesis})`,
);
const prog = await connection.getAccountInfo(ESCROW_PROGRAM_ID);
console.log(
  "program   ",
  ESCROW_PROGRAM_ID.toBase58(),
  prog?.executable ? "deployed" : "NOT FOUND",
);
console.log("config PDA", deriveConfigPda(ESCROW_PROGRAM_ID.toBase58()).address);
const cfg = await getConfigAccount(connection);
console.log("config    ", cfg ?? "not initialized");
const recent = await connection.getSignaturesForAddress(ESCROW_PROGRAM_ID, { limit: 5 });
console.log(
  "recent txs",
  recent.map((r) => ({ sig: r.signature.slice(0, 16) + "…", slot: r.slot, ok: !r.err })),
);

const promo = process.argv[2];
if (promo) {
  console.log("promo     ", await getPromoState(connection, promo));
  console.log("purchases ", await listPurchases(connection, promo));
}
