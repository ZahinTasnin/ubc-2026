import { Connection, PublicKey } from "@solana/web3.js";
import {
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  PUBLIC_DEVNET_RPC,
  redactRpcUrl,
} from "../config";
import { ESCROW_PROGRAM_ID } from "../idl";
import { RealSolanaGateway } from "./gateway";
import { loadRelayerKeypair } from "./keypair";

/**
 * Build the real gateway from environment variables (.env.example). SERVER ONLY.
 *
 * RPC:   QUICKNODE_RPC_URL / QUICKNODE_WSS_URL, else SOLANA_RPC_URL / SOLANA_WS_URL (public Devnet).
 * Keys:  RELAYER_KEYPAIR_PATH (required); RELAYER_PUBLIC_KEY, if set, must match it.
 * Other: ANCHOR_PROGRAM_ID, SOLANA_FINALITY (finalized|confirmed), SOLANA_EVENT_SOURCE
 *        (websocket|streams), SOLANA_SWEEP_MS, SOLANA_TX_TIMEOUT_MS.
 * Mainnet is always refused; a non-Devnet cluster needs ALLOW_NON_DEVNET=1 (local validator).
 */
export async function createSolanaGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log: (msg: string, extra?: Record<string, unknown>) => void = (m, x) =>
    console.log(`[solana] ${m}`, x ?? ""),
): Promise<RealSolanaGateway> {
  const rpcUrl = env.QUICKNODE_RPC_URL || env.SOLANA_RPC_URL || PUBLIC_DEVNET_RPC;
  const wsUrl = env.QUICKNODE_WSS_URL || env.SOLANA_WS_URL || undefined;
  const connection = new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: wsUrl });

  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_GENESIS_HASH) throw new Error("Refusing to start: RPC is Solana MAINNET");
  if (genesis !== DEVNET_GENESIS_HASH && env.ALLOW_NON_DEVNET !== "1") {
    throw new Error("RPC is not Solana Devnet (set ALLOW_NON_DEVNET=1 only for a local validator)");
  }

  const relayer = loadRelayerKeypair(env.RELAYER_KEYPAIR_PATH ?? "");
  if (env.RELAYER_PUBLIC_KEY && env.RELAYER_PUBLIC_KEY !== relayer.publicKey.toBase58()) {
    throw new Error("RELAYER_PUBLIC_KEY does not match the keypair at RELAYER_KEYPAIR_PATH");
  }

  const finality = env.SOLANA_FINALITY === "confirmed" ? "confirmed" : "finalized";
  const eventSource = env.SOLANA_EVENT_SOURCE === "streams" ? "streams" : "websocket";
  const gateway = new RealSolanaGateway({
    connection,
    relayer,
    programId: env.ANCHOR_PROGRAM_ID ? new PublicKey(env.ANCHOR_PROGRAM_ID) : ESCROW_PROGRAM_ID,
    commitment: finality,
    eventSource,
    sweepMs: env.SOLANA_SWEEP_MS ? Number(env.SOLANA_SWEEP_MS) : undefined,
    timeoutMs: env.SOLANA_TX_TIMEOUT_MS ? Number(env.SOLANA_TX_TIMEOUT_MS) : undefined,
    log,
  });

  const cfg = await gateway.getConfig();
  log("gateway ready", {
    rpc: redactRpcUrl(rpcUrl),
    quicknode: Boolean(env.QUICKNODE_RPC_URL),
    eventSource,
    finality,
    relayer: gateway.relayerPublicKey,
    configRelayer: cfg?.relayer ?? null,
  });
  if (cfg && cfg.relayer !== gateway.relayerPublicKey) {
    log(
      "WARNING: this relayer is NOT Config.relayer; markHedged/cancelUnhedged/resolvePromotion will " +
        "fail with NOT_AUTHORIZED until the admin runs set_relayer",
      { configRelayer: cfg.relayer },
    );
  }
  return gateway;
}
