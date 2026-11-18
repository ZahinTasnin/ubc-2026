/**
 * Standalone Streams receiver + Arc gateway (for a demo without apps/api). Prints verified events.
 *   ARC_ESCROW_ADDRESS=0x... ARC_RELAYER_KEY_PATH=... QUICKNODE_STREAMS_SECURITY_TOKEN=... \
 *   ARC_EVENT_SOURCE=streams pnpm --filter @hedged/arc streams:webhook   (then: ngrok http 4100)
 */
import { createArcGatewayFromEnv, startArcStreamsWebhookServer } from "../src/server";

const gw = await createArcGatewayFromEnv();
const port = Number(process.env.STREAMS_WEBHOOK_PORT ?? 4100);
await startArcStreamsWebhookServer({
  port,
  securityToken: process.env.QUICKNODE_STREAMS_SECURITY_TOKEN ?? "",
  escrow: process.env.ARC_ESCROW_ADDRESS,
  onSignals: (s) => gw.ingestStreams(s),
  log: (m, x) => console.log(`[webhook] ${m}`, x ?? ""),
});
await gw.subscribeToDeposits(async (e) => console.log("verified deposit", e));
await gw.subscribeToResolutions(async (e) => console.log("verified resolution", e));
await gw.subscribeToClaims(async (e) => console.log("verified claim", e));
console.log(`listening on :${port}/webhooks/quicknode`);
