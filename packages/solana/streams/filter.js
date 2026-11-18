/* eslint-disable @typescript-eslint/no-unused-vars -- `main` is the QuickNode Streams entry point, called by Streams. */
/**
 * QuickNode Streams filter for the Hedged Refund Promotions escrow program (Solana Devnet).
 *
 * Stream config: network "solana-devnet", dataset "programs_with_logs", destination: webhook
 * (packages/solana/src/server/streams.ts). Self-contained ES5-style JavaScript: no imports, no
 * Node/browser globals, because it runs inside QuickNode's filter runtime.
 *
 * What it does, per delivered batch:
 *  1. keeps only SUCCESSFUL transactions that invoke the escrow program;
 *  2. labels each with the escrow instruction(s) it ran (8-byte Anchor discriminators);
 *  3. extracts the escrow program's Anchor events from the logs ("Program data: <base64>" lines
 *     emitted while the escrow program is the executing program) and labels them by name;
 *     (txs with neither a known escrow instruction nor an escrow event, e.g. IDL uploads, are
 *     dropped);
 *  4. returns null when nothing matched, so Streams delivers (and bills) nothing for that batch.
 *
 * The webhook receiver treats this payload as a NOTIFICATION only: it re-fetches every signature
 * over RPC, waits for the configured commitment and verifies accounts/token balances before any
 * event reaches the backend. Discriminators are checked against the IDL in streams.test.ts.
 */
var PROGRAM_ID = "E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr";

var EVENT_DISCRIMINATORS = {
  "5d0f46aa308cd4db": "ClaimEvent",
  "78f83d531f8e6b90": "DepositEvent",
  b7717c74492ac41d: "HedgeMarkedEvent",
  "69c940abef51966f": "PurchaseCancelledEvent",
  "3adf6db7b795a9fb": "ResolutionEvent",
};

var INSTRUCTION_DISCRIMINATORS = {
  a236d1a7ca47ff99: "cancel_expired_deposit",
  c633e1b20ea960dd: "cancel_unhedged",
  d41ea09ff70f7b81: "claim_merchant",
  "0f101ea1ffe4613c": "claim_refund",
  f223c68952e1f2b6: "deposit",
  d07f1501c2bec446: "initialize_config",
  "346c133c9f596648": "initialize_promo",
  "477350517d7f3fac": "mark_hedged",
  e5b0a6c3aa73fac6: "resolve_promo",
  "886cc35bedba22e8": "set_cancel_timeout",
  "5b3c7dc0b0e1a6da": "set_paused",
  "17f321586e54c425": "set_relayer",
};

var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function main(stream) {
  var batch = stream && stream.data ? stream.data : [];
  var matched = [];
  for (var b = 0; b < batch.length; b++) {
    var txs = Array.isArray(batch[b]) ? batch[b] : [batch[b]];
    for (var t = 0; t < txs.length; t++) {
      var m = matchTransaction(txs[t]);
      if (m) matched.push(m);
    }
  }
  if (matched.length === 0) return null;
  return {
    programId: PROGRAM_ID,
    network: stream.metadata && stream.metadata.network ? stream.metadata.network : null,
    matchedTransactions: matched,
  };
}

function matchTransaction(tx) {
  if (!tx || tx.success === false || !tx.signature) return null;
  var invocations = tx.programInvocations || [];
  var instructions = [];
  var touches = false;
  for (var i = 0; i < invocations.length; i++) {
    var inv = invocations[i];
    if (!inv || inv.programId !== PROGRAM_ID) continue;
    touches = true;
    var data = inv.instruction && inv.instruction.data;
    var name = INSTRUCTION_DISCRIMINATORS[hexPrefix(decodeBase58(data), 8)];
    instructions.push(name || "unknown");
  }
  var events = extractEvents(tx.logs || []);
  var known = false;
  for (var k = 0; k < instructions.length; k++) if (instructions[k] !== "unknown") known = true;
  // Skip Anchor IDL uploads/deploy housekeeping: no escrow instruction and no escrow event.
  if ((!touches || !known) && events.length === 0) return null;
  return {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime == null ? null : tx.blockTime,
    instructions: instructions,
    events: events,
  };
}

/** Anchor `emit!` events of THIS program, in order, tracking the CPI invocation stack. */
function extractEvents(logs) {
  var stack = [];
  var out = [];
  for (var i = 0; i < logs.length; i++) {
    var line = logs[i];
    var inv = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (inv) {
      stack.push(inv[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === PROGRAM_ID && line.indexOf("Program data: ") === 0) {
      var b64 = line.slice("Program data: ".length);
      var name = EVENT_DISCRIMINATORS[hexPrefix(decodeBase64(b64), 8)];
      out.push({ index: out.length, name: name || "unknown", data: b64 });
    }
  }
  return out;
}

function hexPrefix(bytes, n) {
  var s = "";
  for (var i = 0; i < n && i < bytes.length; i++)
    s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}

function decodeBase58(str) {
  if (typeof str !== "string") return [];
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var carry = B58.indexOf(str[i]);
    if (carry < 0) return [];
    for (var j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (var k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return bytes.reverse();
}

function decodeBase64(str) {
  var clean = String(str).replace(/[^A-Za-z0-9+/]/g, "");
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}
