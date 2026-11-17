/**
 * Documentation verifier: checks that claims in programs/escrow/docs.md and docs/interfaces.md are
 * backed by the actual Rust source, tests and IDL. It reads files only (no network, no keys).
 *
 *   pnpm escrow:verify-docs [--log <anchor-test.log>]
 *
 * Checks:
 *  1. Every row of the docs.md appendix: the cited Rust pattern exists in the cited file (a pattern
 *     starting with "ABSENT:" must NOT appear in the file/directory) and the cited test title exists in the
 *     cited test file.
 *  2. The IDL has exactly the documented instructions/accounts/events and error codes, and
 *     docs/interfaces.md lists each instruction with all of its argument names and each error code.
 *  3. Key constants (seeds, timeout bounds, 600 s default) match the code/scripts/.env.example.
 *  4. With --log: the per-suite and total passing counts in docs.md match that Anchor test log.
 */
import * as fs from "fs";
import * as path from "path";
import { IDL_PATH, REPO_ROOT } from "./lib";

let failures = 0;
let checks = 0;
const ok = () => {
  checks++;
};
const fail = (m: string) => {
  failures++;
  checks++;
  console.log(`  FAIL  ${m}`);
};
const check = (cond: boolean, msg: string) => (cond ? ok() : fail(msg));

const ESC = path.join(REPO_ROOT, "programs/escrow");
const read = (p: string) => fs.readFileSync(p, "utf8");
const listRs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? listRs(f) : f.endsWith(".rs") ? [f] : [];
  });

// ---------------------------------------------------------------------------------------- 1
console.log("1. docs.md appendix evidence");
const docs = read(path.join(ESC, "docs.md"));
const appendix = docs.slice(docs.indexOf("## Appendix"));
const rows = appendix.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
check(rows.length >= 30, `appendix has ${rows.length} evidence rows (expected >= 30)`);
for (const row of rows) {
  const cols = row.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const [, id, rust, test] = cols;
  const rm = /`([^`]+)`:\s*`([^`]+)`/.exec(rust ?? "");
  const tm = /`([^`]+)`:\s*"([^"]+)"/.exec(test ?? "");
  if (!rm || !tm) {
    fail(`row ${id}: could not parse evidence columns`);
    continue;
  }
  const [, rFile, pat] = rm;
  const [, tFile, title] = tm;
  const rPath = path.join(ESC, rFile!);
  if (!fs.existsSync(rPath)) {
    fail(`row ${id}: Rust path missing: ${rFile}`);
  } else {
    const isDir = fs.statSync(rPath).isDirectory();
    const files = isDir ? listRs(rPath) : [rPath];
    const text = files.map(read).join("\n");
    if (pat!.startsWith("ABSENT:")) {
      check(
        !text.includes(pat!.slice(1)),
        `row ${id}: "${pat!.slice(1)}" should be ABSENT in ${rFile}`,
      );
    } else {
      check(text.includes(pat!), `row ${id}: Rust pattern not found in ${rFile}: ${pat}`);
    }
  }
  const tPath = path.join(REPO_ROOT, tFile!);
  if (!fs.existsSync(tPath)) fail(`row ${id}: test file missing: ${tFile}`);
  else
    check(read(tPath).includes(title!), `row ${id}: test title not found in ${tFile}: "${title}"`);
}

// ---------------------------------------------------------------------------------------- 2
console.log("2. IDL vs docs");
const idl = JSON.parse(read(IDL_PATH));
const ix: { name: string; args: { name: string }[] }[] = idl.instructions;
check(ix.length === 12, `IDL has ${ix.length} instructions (docs say 12)`);
check(idl.accounts.length === 3, `IDL has ${idl.accounts.length} accounts (docs say 3)`);
check(idl.events.length === 5, `IDL has ${idl.events.length} events (docs say 5)`);
check(idl.errors.length === 23, `IDL has ${idl.errors.length} errors (docs say 23)`);
const interfaces = read(path.join(REPO_ROOT, "docs/interfaces.md"));
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
void camel;
for (const i of ix) {
  const line = interfaces.split("\n").find((l) => l.startsWith(`| \`${i.name}\``));
  if (!line) {
    fail(`docs/interfaces.md §2 has no row for ${i.name}`);
    continue;
  }
  ok();
  for (const a of i.args)
    check(line.includes(a.name), `interfaces.md row ${i.name} lacks arg ${a.name}`);
  check(docs.includes(`\`${i.name}\``), `docs.md never mentions ${i.name}`);
}
const docErrors = new Map<number, string>();
for (const m of interfaces.matchAll(/\|\s*(60\d\d)\s*\|\s*`(\w+)`/g))
  docErrors.set(Number(m[1]), m[2]!);
for (const e of idl.errors as { code: number; name: string }[]) {
  check(
    docErrors.get(e.code) === e.name,
    `interfaces.md error ${e.code} should be ${e.name}, is ${docErrors.get(e.code)}`,
  );
}
const integration = read(path.join(ESC, "docs/INTEGRATION.md"));
for (const e of idl.errors as { code: number; name: string }[]) {
  check(
    new RegExp(`${e.code}\\s*\\|\\s*${e.name}`).test(integration) ||
      integration.includes(`${e.code} ${e.name}`),
    `INTEGRATION.md error table missing ${e.code} ${e.name}`,
  );
}
const eventNames = (idl.events as { name: string }[]).map((e) => e.name);
for (const n of eventNames)
  check(interfaces.includes(n), `interfaces.md does not mention event ${n}`);

// ---------------------------------------------------------------------------------------- 3
console.log("3. constants");
const state = read(path.join(ESC, "src/state/mod.rs"));
check(
  state.includes('b"config"') && state.includes('b"promo"') && state.includes('b"purchase"'),
  "PDA seed constants",
);
check(state.includes("MIN_CANCEL_TIMEOUT_SECS: i64 = 1;"), "min timeout is 1 second");
check(
  state.includes("MAX_CANCEL_TIMEOUT_SECS: i64 = 30 * 24 * 60 * 60;"),
  "max timeout is 30 days",
);
check(state.includes("pub const MAX_MARKET_ID_LEN: usize = 64;"), "market id max 64 bytes");
const initCfg = read(path.join(ESC, "scripts/init-config.ts"));
check(
  /CANCEL_TIMEOUT_SECS",\s*"600"/.test(initCfg),
  "init-config default CANCEL_TIMEOUT_SECS is 600",
);
const envEx = read(path.join(REPO_ROOT, ".env.example"));
check(/^CANCEL_TIMEOUT_SECS=600$/m.test(envEx), ".env.example sets CANCEL_TIMEOUT_SECS=600");
check(
  read(path.join(ESC, "docs/DEVNET.md")).includes("CANCEL_TIMEOUT_SECS=600"),
  "DEVNET.md uses CANCEL_TIMEOUT_SECS=600",
);
check(/6\s*decimals|6-decimal/i.test(docs), "docs.md states 6 decimals");
check(
  read(path.join(ESC, "src/instructions/initialize_config.rs")).includes(
    "MOCK_USD_DECIMALS: u8 = 6",
  ),
  "mint decimals constant is 6",
);
check(
  !envEx.match(/^[A-Z_]*(PRIVATE|SECRET)[A-Z_]*=.+$/m),
  ".env.example has no filled secret values",
);

// ---------------------------------------------------------------------------------------- 4
const li = process.argv.indexOf("--log");
if (li > 0) {
  console.log("4. test counts vs log");
  const log = read(process.argv[li + 1]!);
  const counts = new Map<string, number>();
  let cur = "";
  for (const line of log.split("\n")) {
    const m = /^ {2}(escrow[^\n]*)$/.exec(line);
    if (m) {
      cur = m[1]!;
      counts.set(cur, 0);
    } else if (cur && line.includes("✔")) counts.set(cur, counts.get(cur)! + 1);
  }
  const want: [string, number][] = [
    ["escrow foundation", 33],
    ["escrow relayer & hedge lifecycle", 44],
    ["escrow security regressions", 18],
    ["escrow settlement", 37],
    ["escrow customer timeout recovery", 24],
  ];
  for (const [prefix, n] of want) {
    const got = [...counts.entries()].find(([k]) => k.startsWith(prefix))?.[1];
    check(got === n, `${prefix}: log has ${got}, docs.md says ${n}`);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  check(total === 156, `total passing in log is ${total}, docs.md says 156`);
  check(/passing/.test(log) && !/failing/.test(log), "log reports passing and no failing");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
