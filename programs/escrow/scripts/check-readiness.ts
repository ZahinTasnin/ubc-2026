/**
 * Deployment-readiness check. Offline by default (program IDs, IDL vs build output, interface
 * coverage, artifact size). With --online it also checks the target cluster: deployer balance,
 * whether the program is deployed, its upgrade authority, deployed bytecode == local build, and
 * Config state. It NEVER sends a transaction and never prints secret keys.
 *
 *   pnpm escrow:check [--online]
 *
 * Environment (online): SOLANA_RPC_URL, DEPLOYER_KEYPAIR_PATH (default ~/.config/solana/id.json),
 * ALLOW_NON_DEVNET=1 for a local validator.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  connectDevnet,
  env,
  expandHome,
  IDL_PATH,
  loadKeypair,
  readProgramData,
  REPO_ROOT,
} from "./lib";

const online = process.argv.includes("--online");
const rel = (p: string) => path.join(REPO_ROOT, p);
let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const warn = (m: string) => console.log(`  warn  ${m}`);
const check = (cond: boolean, good: string, bad: string) => (cond ? ok(good) : fail(bad));

const EXPECTED_IX = [
  "initialize_config",
  "set_paused",
  "set_relayer",
  "initialize_promo",
  "deposit",
  "mark_hedged",
  "cancel_unhedged",
  "resolve_promo",
  "claim_refund",
  "claim_merchant",
  "set_cancel_timeout",
  "cancel_expired_deposit",
];
const EXPECTED_ACCOUNTS = ["Config", "Promo", "Purchase"];
const EXPECTED_EVENTS = [
  "DepositEvent",
  "HedgeMarkedEvent",
  "PurchaseCancelledEvent",
  "ResolutionEvent",
  "ClaimEvent",
];

async function main() {
  console.log("Program ID consistency");
  const libId = /declare_id!\("([^"]+)"\)/.exec(
    fs.readFileSync(rel("programs/escrow/src/lib.rs"), "utf8"),
  )?.[1];
  const toml = fs.readFileSync(rel("Anchor.toml"), "utf8");
  const tomlIds = [...toml.matchAll(/^escrow\s*=\s*"([^"]+)"/gm)].map((m) => m[1]!);
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const keypairFile = rel("target/deploy/escrow-keypair.json");
  const keypairId = fs.existsSync(keypairFile)
    ? Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(keypairFile, "utf8"))),
      ).publicKey.toBase58()
    : undefined;
  console.log(`        declare_id! = ${libId}`);
  check(
    tomlIds.length >= 2 && tomlIds.every((i) => i === libId),
    "Anchor.toml [programs.*] match declare_id!",
    `Anchor.toml ids ${tomlIds} != ${libId}`,
  );
  check(
    idl.address === libId,
    "committed IDL address matches",
    `IDL address ${idl.address} != ${libId}`,
  );
  if (keypairId)
    check(
      keypairId === libId,
      "target/deploy/escrow-keypair.json matches (back it up out-of-band!)",
      `deploy keypair is ${keypairId}, not ${libId}: run 'anchor keys sync' or get the original keypair`,
    );
  else
    fail(
      "target/deploy/escrow-keypair.json missing: deploy would create a NEW program id. Restore the keypair or run 'anchor keys sync' and update every env/config",
    );

  console.log("IDL");
  const built = rel("target/idl/escrow.json");
  if (fs.existsSync(built)) {
    const same = JSON.stringify(JSON.parse(fs.readFileSync(built, "utf8"))) === JSON.stringify(idl);
    check(
      same,
      "committed IDL == target/idl (build output)",
      "committed IDL differs from target/idl: re-run 'anchor build' and copy idl/types",
    );
  } else warn("target/idl/escrow.json missing (run anchor build)");
  const ts = rel("programs/escrow/idl/escrow.ts");
  const tsSrc = fs.existsSync(ts) ? fs.readFileSync(ts, "utf8") : "";
  check(
    new RegExp(`address"?:\\s*"${libId}"`).test(tsSrc),
    "committed escrow.ts types present and match the address",
    "programs/escrow/idl/escrow.ts missing or stale",
  );
  const ix: string[] = idl.instructions.map((i: { name: string }) => i.name);
  check(
    EXPECTED_IX.every((n) => ix.includes(n)) && ix.length === EXPECTED_IX.length,
    `IDL exposes all ${EXPECTED_IX.length} instructions`,
    `IDL instructions: ${ix.join(", ")}`,
  );
  const accts: string[] = idl.accounts.map((a: { name: string }) => a.name);
  check(
    EXPECTED_ACCOUNTS.every((n) => accts.includes(n)),
    "IDL exposes Config/Promo/Purchase accounts",
    `IDL accounts: ${accts}`,
  );
  const evs: string[] = idl.events.map((e: { name: string }) => e.name);
  check(
    EXPECTED_EVENTS.every((n) => evs.includes(n)),
    "IDL exposes all 5 events",
    `IDL events: ${evs}`,
  );

  console.log("Build artifact");
  const so = rel("target/deploy/escrow.so");
  let soBytes = 0;
  if (fs.existsSync(so)) {
    soBytes = fs.statSync(so).size;
    const stale = fs.statSync(so).mtimeMs < fs.statSync(rel("programs/escrow/src/lib.rs")).mtimeMs;
    ok(`escrow.so present (${soBytes} bytes)`);
    if (stale) warn("escrow.so is older than lib.rs: re-run 'anchor build'");
  } else fail("target/deploy/escrow.so missing (run 'anchor build')");
  // `solana program deploy` allocates 2x the program length by default (set --max-len to change).
  const dataLen = 45 + soBytes * 2;
  const rentSol = ((dataLen + 128) * 6960) / 1e9;
  console.log(
    `        estimated rent for ProgramData (2x default max-len): ~${rentSol.toFixed(2)} SOL, plus a temporary buffer of ~${(((soBytes + 128 + 37) * 6960) / 1e9).toFixed(2)} SOL (refunded)`,
  );
  const needed = rentSol + ((soBytes + 128 + 37) * 6960) / 1e9 + 0.1;

  if (online) {
    console.log("Cluster (online, read-only)");
    const connection = await connectDevnet();
    const deployerFile = expandHome(env("DEPLOYER_KEYPAIR_PATH", "~/.config/solana/id.json")!);
    const deployer = loadKeypair(deployerFile);
    const bal = (await connection.getBalance(deployer.publicKey)) / 1e9;
    console.log(`        deployer ${deployer.publicKey.toBase58()}: ${bal.toFixed(3)} SOL`);
    const programId = new PublicKey(libId!);
    const pd = await readProgramData(connection, programId);
    if (!pd) {
      (bal >= needed ? ok : warn)(
        `program not deployed yet; deployer balance ${bal.toFixed(2)} SOL vs ~${needed.toFixed(2)} SOL needed`,
      );
    } else {
      ok(`program deployed (last deployed slot ${pd.slot})`);
      console.log(
        `        upgrade authority: ${pd.upgradeAuthority?.toBase58() ?? "NONE (immutable)"}`,
      );
      check(
        !!pd.upgradeAuthority?.equals(deployer.publicKey),
        "deployer key is the upgrade authority (needed for initialize_config/upgrades)",
        "deployer key is NOT the upgrade authority",
      );
      if (soBytes) {
        const local = fs.readFileSync(so);
        const match =
          pd.elf.subarray(0, local.length).equals(local) &&
          pd.elf.subarray(local.length).every((b) => b === 0);
        check(
          match,
          "deployed bytecode == local target/deploy/escrow.so (so the committed IDL matches what is live)",
          "deployed bytecode DIFFERS from local build: redeploy/upgrade, or rebuild before trusting the IDL",
        );
      }
      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
      const cfg = await connection.getAccountInfo(configPda);
      if (cfg) ok("Config initialized (run 'pnpm escrow:init-config' to compare values)");
      else
        warn(
          "Config NOT initialized yet: initialize immediately after deploy (only the upgrade authority can)",
        );
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
