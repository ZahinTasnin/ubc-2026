/**
 * Initialize the escrow's singleton Config (admin = deployer, relayer, mock mint). Idempotent:
 * if Config already exists it is only compared and reported (exit 2 on mismatch, never changed).
 * Only the program's UPGRADE AUTHORITY can initialize (front-running protection), so run this
 * right after deploy with the deployer key.
 *
 *   MOCK_USDC_MINT=<mint> RELAYER_PUBLIC_KEY=<pubkey> pnpm escrow:init-config [--dry-run]
 *
 * Environment: SOLANA_RPC_URL, ADMIN_KEYPAIR_PATH (default ~/.config/solana/id.json; must be the
 * upgrade authority), MOCK_USDC_MINT, RELAYER_PUBLIC_KEY (public key only), ANCHOR_PROGRAM_ID
 * (optional override of the IDL address), ALLOW_NON_DEVNET=1 (local validator only).
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  connectDevnet,
  env,
  IDL_PATH,
  loadKeypair,
  parsePubkey,
  readProgramData,
  requireEnv,
} from "./lib";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const connection = await connectDevnet();
  const admin = loadKeypair(env("ADMIN_KEYPAIR_PATH", "~/.config/solana/id.json")!);
  const mint = parsePubkey("MOCK_USDC_MINT", requireEnv("MOCK_USDC_MINT"));
  const relayer = parsePubkey("RELAYER_PUBLIC_KEY", requireEnv("RELAYER_PUBLIC_KEY"));
  // Customer-recovery timeout (seconds): how long a purchase may sit un-hedged before its customer
  // can cancel it themselves. Must exceed the backend's hedge window. Range 1s..30 days.
  const cancelTimeout = Number(env("CANCEL_TIMEOUT_SECS", "600"));
  if (!Number.isInteger(cancelTimeout) || cancelTimeout < 1 || cancelTimeout > 30 * 24 * 3600) {
    console.error("CANCEL_TIMEOUT_SECS must be an integer between 1 and 2592000.");
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  if (env("ANCHOR_PROGRAM_ID"))
    idl.address = parsePubkey("ANCHOR_PROGRAM_ID", env("ANCHOR_PROGRAM_ID")!).toBase58();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

  console.log(`Program:  ${program.programId.toBase58()}`);
  console.log(`Config:   ${config.toBase58()}`);
  console.log(`Admin:    ${admin.publicKey.toBase58()}${dryRun ? "  [DRY RUN]" : ""}`);

  const pd = await readProgramData(connection, program.programId);
  if (!pd) {
    console.error("Program is not deployed (no ProgramData account) on this cluster.");
    process.exit(1);
  }

  // Typed view of the one account type we read (the IDL-generic Program has no static types here).
  const configAccounts = program.account as unknown as {
    config: {
      fetchNullable(address: PublicKey): Promise<{
        admin: PublicKey;
        relayer: PublicKey;
        mint: PublicKey;
        paused: boolean;
        cancelTimeoutSecs: anchor.BN;
      } | null>;
    };
  };
  const existing = await configAccounts.config.fetchNullable(config);
  if (existing) {
    const drift: string[] = [];
    if (!existing.admin.equals(admin.publicKey))
      drift.push(`admin is ${existing.admin.toBase58()}`);
    if (!existing.relayer.equals(relayer))
      drift.push(`relayer is ${existing.relayer.toBase58()} (rotate with set_relayer)`);
    if (!existing.mint.equals(mint)) drift.push(`mint is ${existing.mint.toBase58()} (immutable)`);
    if (existing.cancelTimeoutSecs.toNumber() !== cancelTimeout) {
      drift.push(
        `cancel timeout is ${existing.cancelTimeoutSecs.toNumber()}s (change with set_cancel_timeout; applies to future promos only)`,
      );
    }
    console.log(`Config already initialized (paused=${existing.paused}).`);
    if (drift.length) {
      console.error(`Config differs from the requested values:\n - ${drift.join("\n - ")}`);
      process.exit(2);
    }
    console.log("Matches requested values. Nothing to do.");
    return;
  }

  if (!pd.upgradeAuthority?.equals(admin.publicKey)) {
    console.error(
      `Signer ${admin.publicKey.toBase58()} is not the program's upgrade authority (${pd.upgradeAuthority?.toBase58() ?? "none — immutable"}). initialize_config would be rejected.`,
    );
    process.exit(1);
  }
  if (dryRun) {
    console.log("[dry run] would call initialize_config.");
    return;
  }
  const sig = await program.methods
    .initializeConfig(relayer, new anchor.BN(cancelTimeout))
    .accounts({
      admin: admin.publicKey,
      program: program.programId,
      programData: pd.programData,
      mint,
    } as never)
    .rpc();
  console.log(`Initialized. tx ${sig}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
