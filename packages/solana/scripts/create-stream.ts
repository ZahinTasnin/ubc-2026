/**
 * Create (or fetch, idempotently) the QuickNode Stream that feeds the escrow event pipeline.
 *
 *   QUICKNODE_API_KEY=... STREAMS_WEBHOOK_URL=https://<public-host>/webhooks/quicknode \
 *     pnpm --filter @hedged/solana streams:create [--dry-run] [--test-filter]
 *
 * Stream: network solana-devnet · dataset programs_with_logs · filter streams/filter.js (only
 * successful txs that invoke the escrow program, with decoded event/instruction names) ·
 * destination webhook (HMAC-signed with the security token). API: POST
 * https://api.quicknode.com/streams/rest/v1/streams (x-api-key), per
 * https://www.quicknode.com/docs/streams/rest-api/create-stream . `external_id` makes retries safe.
 *
 * --test-filter runs the filter on QuickNode's side (POST /streams/test_filter) against the Devnet
 * slot of the escrow program's latest transaction, without creating anything.
 */
import { randomBytes } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID, PUBLIC_DEVNET_RPC } from "../src/index";
import { streamsFilterSource } from "../src/server/streams";

const API = "https://api.quicknode.com/streams/rest/v1/streams";
const dryRun = process.argv.includes("--dry-run");
const testFilter = process.argv.includes("--test-filter");
const apiKey = process.env.QUICKNODE_API_KEY ?? "";
if (!apiKey && !dryRun) throw new Error("Set QUICKNODE_API_KEY (QuickNode dashboard → API Keys)");

const filter_function = Buffer.from(streamsFilterSource(), "utf8").toString("base64");
const headers = { "content-type": "application/json", "x-api-key": apiKey };

if (testFilter) {
  const rpc = new Connection(
    process.env.QUICKNODE_RPC_URL || process.env.SOLANA_RPC_URL || PUBLIC_DEVNET_RPC,
  );
  const [latest] = await rpc.getSignaturesForAddress(ESCROW_PROGRAM_ID, { limit: 1 });
  if (!latest) throw new Error("no escrow transactions on Devnet yet");
  const body = {
    network: "solana-devnet",
    dataset: "programs_with_logs",
    block: String(latest.slot),
    filter_function,
  };
  console.log(`test_filter on slot ${latest.slot} (tx ${latest.signature.slice(0, 12)}…)`);
  if (dryRun) process.exit(0);
  const r = await fetch(`${API}/test_filter`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  console.log(r.status, JSON.stringify(await r.json().catch(() => null), null, 2));
  process.exit(r.ok ? 0 : 1);
}

const url = process.env.STREAMS_WEBHOOK_URL ?? "";
if (!/^https?:\/\//.test(url)) throw new Error("Set STREAMS_WEBHOOK_URL to the public webhook URL");
let token = process.env.QUICKNODE_STREAMS_SECURITY_TOKEN ?? "";
let generated = false;
if (token.length < 32) {
  token = randomBytes(32).toString("hex");
  generated = true;
}

const body = {
  name: "hedged-refund-promotions escrow (solana-devnet)",
  external_id: "hedged-escrow-solana-devnet",
  network: "solana-devnet",
  dataset: "programs_with_logs",
  filter_function,
  filter_language: "javascript",
  region: "usa_east",
  // Solana has sub-second blocks: tip streams need a batch >= 5; elastic batching delivers
  // whatever is ready at the tip instead of waiting for a full batch.
  dataset_batch_size: 5,
  elastic_batch_enabled: true,
  fix_block_reorgs: 0,
  keep_distance_from_tip: 0,
  destination: "webhook",
  destination_attributes: {
    url,
    compression: "none",
    headers: {},
    max_retry: 5,
    retry_interval_sec: 2,
    post_timeout_sec: 10,
    security_token: token,
  },
  status: "active",
};

console.log(
  JSON.stringify(
    {
      ...body,
      filter_function: `<base64 of streams/filter.js, ${filter_function.length} chars>`,
      destination_attributes: { ...body.destination_attributes, security_token: "<redacted>" },
    },
    null,
    2,
  ),
);
if (dryRun) process.exit(0);

const r = await fetch(API, { method: "POST", headers, body: JSON.stringify(body) });
const json = (await r.json().catch(() => null)) as { id?: string; status?: string } | null;
console.log(
  r.status,
  r.status === 201 ? "created" : r.status === 200 ? "already existed (external_id)" : "error",
);
console.log(JSON.stringify({ id: json?.id, status: json?.status }, null, 2));
if (!r.ok) {
  console.log(JSON.stringify(json, null, 2));
  process.exit(1);
}
if (generated) {
  console.log("\nAdd this to the server .env (secret, never commit):");
  console.log(`QUICKNODE_STREAMS_SECURITY_TOKEN=${token}`);
}
