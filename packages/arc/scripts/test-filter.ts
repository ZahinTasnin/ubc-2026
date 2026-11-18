/**
 * Validate streams/filter.js with QuickNode's read-only POST /streams/test_filter (creates NO Stream).
 *   set -a; . ~/.config/ubc-hackathon/quicknode.env; set +a
 *   ARC_ESCROW_ADDRESS=0x... pnpm --filter @hedged/arc streams:test-filter [block]
 */
import { arcStreamsFilterSource } from "../src/server/streams";

const key = process.env.QUICKNODE_API_KEY;
if (!key) throw new Error("QUICKNODE_API_KEY not set");
const escrow = process.env.ARC_ESCROW_ADDRESS ?? "0x0000000000000000000000000000000000000001";
let block = process.argv[2];
if (!block) {
  const r = await fetch("https://rpc.testnet.arc.io", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber" }),
  });
  block = String(parseInt(((await r.json()) as { result: string }).result, 16) - 20);
}
const res = await fetch("https://api.quicknode.com/streams/rest/v1/streams/test_filter", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key },
  body: JSON.stringify({
    network: "arc-testnet",
    dataset: "logs",
    block,
    filter_function: Buffer.from(arcStreamsFilterSource(escrow)).toString("base64"),
  }),
});
const text = await res.text();
console.log({ status: res.status, block, escrow });
console.log(text.slice(0, 1500));
