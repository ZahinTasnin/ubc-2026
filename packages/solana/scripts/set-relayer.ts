/**
 * ADMIN ONLY (Dev 2 / Caedy, the program's upgrade authority = Config.admin): rotate the single
 * relayer key with `set_relayer`. Devnet only. Prints public keys only.
 *
 *   NEW_RELAYER=<pubkey> ADMIN_KEYPAIR_PATH=~/.config/solana/id.json \
 *     pnpm --filter @hedged/solana relayer:set [--dry-run]
 *
 * Reversible: run it again with the previous relayer pubkey to switch back.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  DEVNET_GENESIS_HASH,
  ESCROW_PROGRAM_ID,
  PUBLIC_DEVNET_RPC,
  createEscrowProgram,
  deriveConfigPda,
  getConfigAccount,
} from "../src/index";
import { loadRelayerKeypair } from "../src/server/keypair";

const dryRun = process.argv.includes("--dry-run");
const url = process.env.SOLANA_RPC_URL || PUBLIC_DEVNET_RPC;
const connection = new Connection(url, "confirmed");
if (
  (await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH &&
  process.env.ALLOW_NON_DEVNET !== "1"
) {
  throw new Error("Refusing: RPC is not Solana Devnet");
}
const newRelayer = new PublicKey(process.env.NEW_RELAYER ?? "");
// Same loader as the relayer (never prints secrets). Admin keys normally live in ~/.config/solana.
const admin = loadRelayerKeypair(process.env.ADMIN_KEYPAIR_PATH || "~/.config/solana/id.json");

const before = await getConfigAccount(connection);
if (!before) throw new Error("Config is not initialized");
console.log("admin (signer) ", admin.publicKey.toBase58());
console.log("Config.admin   ", before.admin);
console.log("relayer now    ", before.relayer);
console.log("relayer -> new ", newRelayer.toBase58());
if (before.admin !== admin.publicKey.toBase58()) throw new Error("signer is not Config.admin");
if (before.relayer === newRelayer.toBase58()) {
  console.log("Already set. Nothing to do.");
  process.exit(0);
}
if (dryRun) {
  console.log("--dry-run: not sending");
  process.exit(0);
}
const ix = await createEscrowProgram(connection)
  .methods.setRelayer(newRelayer)
  .accountsStrict({
    admin: admin.publicKey,
    config: new PublicKey(deriveConfigPda(ESCROW_PROGRAM_ID.toBase58()).address),
  })
  .instruction();
const tx = new Transaction().add(ix);
const sig = await connection.sendTransaction(tx, [admin]);
await connection.confirmTransaction(sig, "finalized");
const after = await getConfigAccount(connection, ESCROW_PROGRAM_ID, "finalized");
console.log("signature      ", sig);
console.log("relayer after  ", after?.relayer);
