/**
 * Standalone QuickNode Streams receiver + verified event log (runs without apps/api).
 *
 *   RELAYER_KEYPAIR_PATH=~/.config/solana/ubc-relayer.json QUICKNODE_STREAMS_SECURITY_TOKEN=... \
 *   QUICKNODE_RPC_URL=... STREAMS_WEBHOOK_PORT=4100 pnpm --filter @hedged/solana streams:webhook
 *
 * Expose it (e.g. `ngrok http 4100`) and point the Stream at https://<host>/webhooks/quicknode.
 * Every Streams delivery is HMAC-checked, then each signature is re-fetched and verified over RPC
 * before it is printed as a verified event.
 */
import { createSolanaGatewayFromEnv, startStreamsWebhookServer } from "../src/server/index";

const token = process.env.QUICKNODE_STREAMS_SECURITY_TOKEN ?? "";
if (token.length < 32)
  throw new Error("QUICKNODE_STREAMS_SECURITY_TOKEN (>= 32 chars) is required");
const gateway = await createSolanaGatewayFromEnv({
  ...process.env,
  SOLANA_EVENT_SOURCE: "streams",
});
const print = (kind: string) => async (e: object) =>
  console.log(`[verified ${kind}]`, JSON.stringify(e));
await gateway.subscribeToDeposits(print("deposit"));
await gateway.subscribeToResolutions(print("resolution"));
await gateway.subscribeToClaims(print("claim"));
const port = Number(process.env.STREAMS_WEBHOOK_PORT ?? 4100);
await startStreamsWebhookServer({
  port,
  securityToken: token,
  onSignals: (s) => gateway.ingestStreams(s),
  log: (m, x) => console.log(`[streams] ${m}`, JSON.stringify(x ?? {})),
});
console.log(`listening on :${port}/webhooks/quicknode`);
