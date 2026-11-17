// Shared helpers for the Dev 2 Devnet scripts. No secrets are ever printed or written to the repo.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const IDL_PATH = path.join(REPO_ROOT, "programs/escrow/idl/escrow.json");

export const expandHome = (p: string) =>
  p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;

export function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) {
    console.error(`Missing required environment variable ${name}.`);
    process.exit(1);
  }
  return v;
}

export function loadKeypair(file: string): Keypair {
  const p = expandHome(file);
  if (!fs.existsSync(p)) {
    console.error(`Keypair file not found: ${p}`);
    process.exit(1);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export function parsePubkey(label: string, value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    console.error(`${label} is not a valid base58 public key: ${value}`);
    process.exit(1);
  }
}

/** Host only: QuickNode URLs embed an API key, so never print the full RPC URL. */
export const rpcHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
};

/**
 * Cluster guard. Mainnet is ALWAYS refused (CLAUDE.md §2, §12.6). Anything that is not Devnet
 * (e.g. a local validator) additionally needs ALLOW_NON_DEVNET=1.
 */
export async function connectDevnet(): Promise<Connection> {
  const url = env("SOLANA_RPC_URL", "https://api.devnet.solana.com")!;
  const connection = new Connection(url, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_GENESIS) {
    console.error("Refusing to run: RPC is MAINNET. This project is Devnet-only.");
    process.exit(1);
  }
  if (genesis !== DEVNET_GENESIS && env("ALLOW_NON_DEVNET") !== "1") {
    console.error(
      `RPC (${rpcHost(url)}) is not Devnet (genesis ${genesis}). Set ALLOW_NON_DEVNET=1 to run against a local validator.`,
    );
    process.exit(1);
  }
  console.log(
    `Cluster: ${genesis === DEVNET_GENESIS ? "devnet" : "non-devnet (allowed)"} via ${rpcHost(url)}`,
  );
  return connection;
}

/** ProgramData address + decoded upgrade authority of an upgradeable program (null if none/absent). */
export async function readProgramData(connection: Connection, programId: PublicKey) {
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  );
  const info = await connection.getAccountInfo(programData, "confirmed");
  if (!info) return null;
  const hasAuthority = info.data[12] === 1;
  return {
    programData,
    slot: Number(info.data.readBigUInt64LE(4)),
    upgradeAuthority: hasAuthority ? new PublicKey(info.data.subarray(13, 45)) : null,
    /** The deployed ELF bytes (program data account is zero-padded up to max_len). */
    elf: info.data.subarray(45),
  };
}
