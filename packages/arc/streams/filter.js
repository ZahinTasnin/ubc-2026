// QuickNode Streams filter: Arc (EVM), dataset "logs".
//
// Input (verified against `arc-testnet` with POST /streams/rest/v1/streams/test_filter):
//   stream.data = [ blockLogs, ... ]  one entry per block in the batch
//   blockLogs   = [ txLogs, ... ]     one entry per transaction in the block
//   txLogs      = [ { address, topics, data, transactionHash, blockNumber (hex), logIndex (hex), ... } ]
// Output: only the transactions that emitted one of the HedgedEscrow events, or null (no delivery).
// `__ESCROW_ADDRESS__` is replaced with the deployed contract address by scripts/create-stream.ts.
// The webhook treats this as a NOTIFICATION: every tx hash is re-fetched and verified over RPC.
var ESCROW = "__ESCROW_ADDRESS__";
var TOPICS = {
  "0x832dbac6943f200f3391765fa94a6d162d9e432edb193b5f446c00f41aa03087": "DepositEvent",
  "0xaa3f9eba0c59330c7b8fc0569eb9b8cc47cade72451337d925ed54fd541da590": "HedgeMarkedEvent",
  "0xf5e50a8a9b3e8d8acbef64c3341efb1f3ff66db191d51b9f79cd68cfa191c9da": "PurchaseCancelledEvent",
  "0x70796b590a520ab981399a999c76ed6e7fc7ad467ac2ca9f9c6be084d1e987d7": "ResolutionEvent",
  "0xaae257e914f474a827624fef3f5acb18aac1bcdf7aa86f7a76fbc6910d18efed": "ClaimEvent",
};

function collect(node, out, depth) {
  if (!node || depth > 4) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) collect(node[i], out, depth + 1);
    return;
  }
  if (typeof node !== "object" || typeof node.address !== "string") return;
  if (node.address.toLowerCase() !== ESCROW || node.removed === true) return;
  var name = node.topics && TOPICS[String(node.topics[0]).toLowerCase()];
  if (!name) return;
  var key = node.transactionHash;
  if (!out[key]) {
    out[key] = {
      txHash: key,
      blockNumber:
        typeof node.blockNumber === "string" ? parseInt(node.blockNumber, 16) : node.blockNumber,
      events: [],
    };
  }
  out[key].events.push(name);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- entry point called by QuickNode Streams
function main(stream) {
  var data = stream && stream.data !== undefined ? stream.data : stream;
  var byTx = {};
  collect(data, byTx, 0);
  var matched = Object.keys(byTx).map(function (k) {
    return byTx[k];
  });
  if (matched.length === 0) return null;
  return { matchedTransactions: matched };
}
