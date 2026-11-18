import { Keypair } from "@solana/web3.js";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (packages/solana/src/server -> ../../../..). Keys must never live inside it. */
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

export const expandHome = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

/**
 * Load the relayer keypair (Solana CLI JSON array). SERVER ONLY. The secret is never logged or
 * returned in errors; only the public key may be printed.
 */
export function loadRelayerKeypair(
  path: string,
  opts: { allowInsideRepo?: boolean } = {},
): Keypair {
  if (!path) throw new Error("RELAYER_KEYPAIR_PATH is not set");
  const file = resolve(expandHome(path));
  if (!opts.allowInsideRepo && (file === REPO_ROOT || file.startsWith(REPO_ROOT + sep))) {
    throw new Error("Refusing to load a relayer keypair from inside the repository");
  }
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Relayer keypair not readable at ${file}`);
  }
  const mode = statSync(file).mode & 0o077;
  if (mode !== 0 && process.platform !== "win32") {
    // Not fatal (a teammate's file may be 644), but say so without printing anything secret.
    console.warn(`[solana] relayer keypair ${file} is readable by other users; chmod 600 it`);
  }
  try {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error(`Relayer keypair at ${file} is not a Solana CLI keypair JSON file`);
  }
}
