/**
 * Create (or reuse) the QuickNode Stream that powers the "Best Use of QuickNode Streams" bounty:
 *   network arc-testnet, dataset logs, filter streams/filter.js (escrow events only),
 *   destination webhook (gzip, HMAC-signed), start at the current block.
 *   set -a; . ~/.config/ubc-hackathon/quicknode.env; set +a
 *   ARC_ESCROW_ADDRESS=0x... STREAMS_WEBHOOK_URL=https://<host>/webhooks/quicknode \
 *   pnpm --filter @hedged/arc streams:create [--dry-run]
 * Idempotent by name. Prints the generated security token ONCE: put it in the server .env as
 * QUICKNODE_STREAMS_SECURITY_TOKEN. Field names per https://api.quicknode.com/streams/rest/openapi.json
 */
import { randomBytes } from "node:crypto";
import { arcStreamsFilterSource } from "../src/server/streams";

const API = "https://api.quicknode.com/streams/rest/v1/streams";
const key = process.env.QUICKNODE_API_KEY;
const escrow = process.env.ARC_ESCROW_ADDRESS;
const url = process.env.STREAMS_WEBHOOK_URL;
if (!key || !escrow || !url)
  throw new Error("need QUICKNODE_API_KEY, ARC_ESCROW_ADDRESS, STREAMS_WEBHOOK_URL");
if (!/^https:\/\//.test(url)) throw new Error("STREAMS_WEBHOOK_URL must be https");
const name = `hedged-escrow-arc-${escrow.slice(2, 10).toLowerCase()}`;
const headers = { "content-type": "application/json", "x-api-key": key };

const list = (await (await fetch(`${API}?limit=100`, { headers })).json()) as {
  data?: { id: string; name: string }[];
};
const existing = list.data?.find((s) => s.name === name);
if (existing) {
  console.log({ reused: existing.id, name });
  process.exit(0);
}
const r = await fetch("https://rpc.testnet.arc.io", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber" }),
});
const start = parseInt(((await r.json()) as { result: string }).result, 16);
const token = randomBytes(24).toString("hex");
const body = {
  name,
  network: "arc-testnet",
  dataset: "logs",
  filter_function: Buffer.from(arcStreamsFilterSource(escrow)).toString("base64"),
  region: "usa_east",
  start_range: start,
  end_range: -1,
  dataset_batch_size: 1,
  include_stream_metadata: "body",
  status: "active",
  destination: "webhook",
  destination_attributes: {
    url,
    compression: "gzip",
    headers: {},
    max_retry: 3,
    retry_interval_sec: 1,
    post_timeout_sec: 10,
    security_token: token,
  },
};
if (process.argv.includes("--dry-run")) {
  console.log(
    JSON.stringify(
      {
        ...body,
        filter_function: "<base64>",
        destination_attributes: { ...body.destination_attributes, security_token: "<generated>" },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const res = await fetch(API, { method: "POST", headers, body: JSON.stringify(body) });
const out = (await res.json()) as { id?: string };
console.log({ status: res.status, id: out.id, name });
if (res.ok)
  console.log(`QUICKNODE_STREAMS_SECURITY_TOKEN=${token}   # server .env only, never commit`);
else console.log(out);
