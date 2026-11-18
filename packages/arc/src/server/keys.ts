import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** Repo root (packages/arc/src/server -> ../../../..). Keys must never live inside it. */
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

export const expandHome = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

/**
 * Load an EVM key file kept OUTSIDE the repo: JSON `{ "privateKey": "0x..." }` (what
 * scripts/keygen writes) or a bare 0x-hex line. SERVER ONLY; the secret is never logged.
 */
export function loadArcAccount(
  path: string,
  opts: { allowInsideRepo?: boolean; label?: string } = {},
): PrivateKeyAccount {
  const label = opts.label ?? "key";
  if (!path) throw new Error(`${label} path is not set`);
  const file = resolve(expandHome(path));
  if (!opts.allowInsideRepo && (file === REPO_ROOT || file.startsWith(REPO_ROOT + sep))) {
    throw new Error(`Refusing to load a ${label} from inside the repository`);
  }
  let raw: string;
  try {
    raw = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error(`${label} not readable at ${file}`);
  }
  if ((statSync(file).mode & 0o077) !== 0 && process.platform !== "win32") {
    console.warn(`[arc] ${label} file ${file} is readable by other users; chmod 600 it`);
  }
  let pk = raw;
  if (raw.startsWith("{")) {
    try {
      pk = String((JSON.parse(raw) as { privateKey?: unknown }).privateKey ?? "");
    } catch {
      throw new Error(`${label} at ${file} is not valid JSON`);
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk))
    throw new Error(`${label} at ${file} has no 0x-prefixed 32-byte private key`);
  return privateKeyToAccount(pk as `0x${string}`);
}
