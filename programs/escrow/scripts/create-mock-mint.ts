/**
 * Create (or reuse) the 6-decimal mock USD SPL mint on Devnet and top up developer wallets.
 * Valueless test tokens only. Idempotent: re-running reuses the mint and tops each recipient up
 * to the target balance (it never mints beyond the target).
 *
 *   MINT_RECIPIENTS="<pubkey>[:tokens],<pubkey>" pnpm escrow:mint [--dry-run]
 *
 * Environment (see programs/escrow/docs/DEVNET.md):
 *   SOLANA_RPC_URL           default https://api.devnet.solana.com
 *   PAYER_KEYPAIR_PATH       default ~/.config/solana/id.json  (fee payer AND mint authority)
 *   MOCK_USDC_MINT           reuse this existing mint (public address) instead of creating one
 *   MOCK_MINT_KEYPAIR_PATH   default ~/.config/hedged/mock-usd-mint.json  (created if missing,
 *                            mode 0600, kept OUTSIDE the repo; gives the mint a stable address)
 *   MINT_RECIPIENTS          comma-separated "pubkey" or "pubkey:tokens" (whole tokens)
 *   MINT_TOPUP_TOKENS        default target balance per recipient, whole tokens (default 1000)
 *   ALLOW_NON_DEVNET=1       only for a local validator
 */
import {
  createMint,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { connectDevnet, env, expandHome, loadKeypair, parsePubkey } from "./lib";

const DECIMALS = 6;
const dryRun = process.argv.includes("--dry-run");

function parseRecipients(): { owner: PublicKey; target: bigint }[] {
  const defaultTokens = BigInt(env("MINT_TOPUP_TOKENS", "1000")!);
  const raw = env("MINT_RECIPIENTS", "")!;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [addr, tokens] = entry.split(":");
      const whole = tokens ? BigInt(tokens) : defaultTokens;
      return {
        owner: parsePubkey("MINT_RECIPIENTS entry", addr!),
        target: whole * 10n ** BigInt(DECIMALS),
      };
    });
}

function mintKeypair(): Keypair | null {
  const file = expandHome(env("MOCK_MINT_KEYPAIR_PATH", "~/.config/hedged/mock-usd-mint.json")!);
  if (fs.existsSync(file))
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  if (dryRun) return null; // never invent an address in a dry run
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(
    `Generated mint keypair at ${file} (kept outside the repo; back it up if you want a stable address).`,
  );
  return kp;
}

async function main() {
  const connection = await connectDevnet();
  const payer = loadKeypair(env("PAYER_KEYPAIR_PATH", "~/.config/solana/id.json")!);
  const recipients = parseRecipients();
  console.log(
    `Payer / mint authority: ${payer.publicKey.toBase58()}${dryRun ? "  [DRY RUN]" : ""}`,
  );

  // 1. Mint: reuse MOCK_USDC_MINT, else the stable keypair address; create only if absent.
  const existingAddr = env("MOCK_USDC_MINT");
  const keypair = existingAddr ? null : mintKeypair();
  if (!existingAddr && !keypair) {
    // Dry run with no mint keypair yet: the address does not exist until the first real run.
    console.log(
      `[dry run] no mint keypair at ${env("MOCK_MINT_KEYPAIR_PATH", "~/.config/hedged/mock-usd-mint.json")}: ` +
        `a real run would generate one, create a ${DECIMALS}-decimals mint (no freeze authority) ` +
        `and top up ${recipients.length} recipient(s). Nothing was changed.`,
    );
    return;
  }
  const mintAddress = existingAddr
    ? parsePubkey("MOCK_USDC_MINT", existingAddr)
    : keypair!.publicKey;
  const mintInfo = await connection.getAccountInfo(mintAddress, "confirmed");
  if (!mintInfo) {
    if (existingAddr) {
      console.error(`MOCK_USDC_MINT ${existingAddr} does not exist on this cluster.`);
      process.exit(1);
    }
    console.log(
      `Creating ${DECIMALS}-decimals mint ${mintAddress.toBase58()} (no freeze authority)...`,
    );
    if (!dryRun) await createMint(connection, payer, payer.publicKey, null, DECIMALS, keypair!);
  } else {
    console.log(`Reusing existing mint ${mintAddress.toBase58()}`);
  }
  if (mintInfo || !dryRun) {
    const m = await getMint(connection, mintAddress, "confirmed");
    if (m.decimals !== DECIMALS) {
      console.error(`Mint has ${m.decimals} decimals; the escrow requires ${DECIMALS}.`);
      process.exit(1);
    }
    if (m.freezeAuthority) {
      console.warn(
        `WARNING: mint has a freeze authority (${m.freezeAuthority.toBase58()}); it could freeze escrow vaults.`,
      );
    }
    if (recipients.length && !m.mintAuthority?.equals(payer.publicKey)) {
      console.error(
        `Payer is not the mint authority (${m.mintAuthority?.toBase58() ?? "none"}); cannot mint to recipients.`,
      );
      process.exit(1);
    }
  }

  // 2. Top up each recipient's ATA to its target balance (idempotent).
  for (const { owner, target } of recipients) {
    const ata = getAssociatedTokenAddressSync(mintAddress, owner);
    if (dryRun) {
      console.log(
        `[dry run] would top up ${owner.toBase58()} (ATA ${ata.toBase58()}) to ${target / 10n ** 6n} tokens`,
      );
      continue;
    }
    const acct = await getOrCreateAssociatedTokenAccount(connection, payer, mintAddress, owner);
    const missing = target > acct.amount ? target - acct.amount : 0n;
    if (missing > 0n) await mintTo(connection, payer, mintAddress, acct.address, payer, missing);
    console.log(
      `${owner.toBase58()}  ATA ${acct.address.toBase58()}  +${missing / 10n ** 6n} tokens -> ${(acct.amount + missing) / 10n ** 6n} total`,
    );
  }

  console.log("\nAdd to your .env (public values, safe to share):");
  console.log(`MOCK_USDC_MINT=${mintAddress.toBase58()}`);
  console.log(`NEXT_PUBLIC_MOCK_USDC_MINT=${mintAddress.toBase58()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
