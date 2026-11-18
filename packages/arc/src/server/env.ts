import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import {
  ARC_TESTNET,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC,
  escrowAddressFromEnv,
} from "../config";
import { ArcGateway } from "./gateway";
import { loadArcAccount } from "./keys";

const redact = (u: string) =>
  u
    .replace(/(quiknode\.pro\/)[^/]+/, "$1<redacted>")
    .replace(/(\/v2\/|apikey=)[^/&]+/i, "$1<redacted>");

/**
 * Build the Arc gateway from env (the one-line switch for apps/api). SERVER ONLY.
 *   ARC_RPC_URL (default public Arc testnet; a QuickNode Arc endpoint if you have one), ARC_WSS_URL
 *   ARC_ESCROW_ADDRESS (required), ARC_RELAYER_KEY_PATH (required, outside the repo)
 *   ARC_FINALITY finalized|confirmed, ARC_EVENT_SOURCE poll|websocket|streams, ARC_SWEEP_MS, ARC_TX_TIMEOUT_MS
 * Only Arc testnet (5042002) is accepted; a local anvil (31337) needs ALLOW_LOCAL_CHAIN=1. Mainnet is refused.
 */
export async function createArcGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log: (msg: string, extra?: Record<string, unknown>) => void = (m, x) =>
    console.log(`[arc] ${m}`, x ?? ""),
): Promise<ArcGateway> {
  const rpcUrl = env.ARC_RPC_URL || ARC_TESTNET_RPC;
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (chainId === 5042) throw new Error("Refusing to start: RPC is Arc MAINNET");
  if (chainId !== ARC_TESTNET_CHAIN_ID && !(chainId === 31337 && env.ALLOW_LOCAL_CHAIN === "1")) {
    throw new Error(
      `RPC chain id ${chainId} is not Arc testnet (set ALLOW_LOCAL_CHAIN=1 only for anvil)`,
    );
  }
  const chain =
    chainId === ARC_TESTNET_CHAIN_ID
      ? ARC_TESTNET
      : defineChain({
          id: 31337,
          name: "anvil",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        });

  const escrow = escrowAddressFromEnv(env);
  if (!escrow) throw new Error("ARC_ESCROW_ADDRESS is not set");
  const relayer = loadArcAccount(env.ARC_RELAYER_KEY_PATH ?? "", { label: "relayer key" });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: relayer });
  const token = (await publicClient.readContract({
    address: escrow,
    abi: [
      {
        type: "function",
        name: "token",
        inputs: [],
        outputs: [{ type: "address" }],
        stateMutability: "view",
      },
    ],
    functionName: "token",
  })) as Address;

  const finality = env.ARC_FINALITY === "confirmed" ? "confirmed" : "finalized";
  const eventSource =
    env.ARC_EVENT_SOURCE === "streams"
      ? "streams"
      : env.ARC_EVENT_SOURCE === "websocket"
        ? "websocket"
        : "poll";
  const gateway = new ArcGateway({
    publicClient,
    walletClient,
    relayer,
    escrow,
    token,
    commitment: finality,
    eventSource,
    wssUrl: env.ARC_WSS_URL || undefined,
    sweepMs: env.ARC_SWEEP_MS ? Number(env.ARC_SWEEP_MS) : undefined,
    timeoutMs: env.ARC_TX_TIMEOUT_MS ? Number(env.ARC_TX_TIMEOUT_MS) : undefined,
    log,
  });
  const cfg = await gateway.getConfig();
  log("gateway ready", {
    rpc: redact(rpcUrl),
    chainId,
    escrow,
    token,
    eventSource,
    finality,
    relayer: relayer.address,
    configRelayer: cfg?.relayer ?? null,
  });
  if (cfg && cfg.relayer.toLowerCase() !== relayer.address.toLowerCase()) {
    log(
      "WARNING: this key is NOT the escrow's relayer; relayer calls will fail with NOT_AUTHORIZED until the admin runs setRelayer",
    );
  }
  return gateway;
}
