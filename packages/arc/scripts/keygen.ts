/**
 * Generate an Arc key file OUTSIDE the repo (default ~/.config/arc/<name>.json, mode 600) and
 * print ONLY its public address. Usage: pnpm --filter @hedged/arc exec tsx scripts/keygen.ts ubc-relayer
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const name = process.argv[2] ?? "ubc-relayer";
const dir = join(homedir(), ".config", "arc");
const file = join(dir, `${name}.json`);
if (existsSync(file)) {
  console.error(`${file} already exists; not overwriting`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const pk = generatePrivateKey();
writeFileSync(file, JSON.stringify({ privateKey: pk }), { mode: 0o600 });
console.log(JSON.stringify({ file, address: privateKeyToAccount(pk).address }));
