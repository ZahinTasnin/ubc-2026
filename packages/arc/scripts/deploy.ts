/**
 * Deploy HedgedEscrow to Arc TESTNET (constructor = initialize_config: deployer becomes admin).
 *   ARC_DEPLOYER_KEY_PATH=~/.config/arc/ubc-deployer.json \
 *   ARC_RELAYER_ADDRESS=0x... [CANCEL_TIMEOUT_SECS=600] [ARC_RPC_URL=...] \
 *   pnpm --filter @hedged/arc deploy [--dry-run]
 * Token = Arc's USDC ERC-20 interface (0x3600...0000, 6 decimals). The deployer pays gas in USDC
 * (fund it at https://faucet.circle.com, Arc Testnet). Refuses any chain but Arc testnet.
 */
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { HEDGED_ESCROW_ABI, HEDGED_ESCROW_BYTECODE } from "../src/abi";
import {
  ARC_TESTNET,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER,
  ARC_TESTNET_RPC,
  ARC_USDC_ERC20,
} from "../src/config";
import { loadArcAccount } from "../src/server/keys";

const dry = process.argv.includes("--dry-run");
const rpc = process.env.ARC_RPC_URL || ARC_TESTNET_RPC;
const pub = createPublicClient({ chain: ARC_TESTNET, transport: http(rpc) });
const id = await pub.getChainId();
if (id !== ARC_TESTNET_CHAIN_ID) throw new Error(`chain ${id} is not Arc testnet`);
const deployer = loadArcAccount(process.env.ARC_DEPLOYER_KEY_PATH ?? "", { label: "deployer key" });
const relayer = getAddress(process.env.ARC_RELAYER_ADDRESS ?? "");
const timeout = BigInt(process.env.CANCEL_TIMEOUT_SECS ?? "600");
const bal = await pub.getBalance({ address: deployer.address });
console.log({
  deployer: deployer.address,
  nativeUsdc18: bal.toString(),
  relayer,
  token: ARC_USDC_ERC20,
  timeout: timeout.toString(),
});
if (bal === 0n) {
  console.error(
    `Deployer has no USDC for gas. Fund ${deployer.address} at https://faucet.circle.com (Arc Testnet).`,
  );
  process.exit(1);
}
if (dry) process.exit(0);
const w = createWalletClient({ chain: ARC_TESTNET, transport: http(rpc), account: deployer });
const hash = await w.deployContract({
  abi: HEDGED_ESCROW_ABI,
  bytecode: HEDGED_ESCROW_BYTECODE,
  args: [ARC_USDC_ERC20, relayer, timeout],
});
const r = await pub.waitForTransactionReceipt({ hash });
console.log({
  status: r.status,
  escrow: r.contractAddress,
  tx: hash,
  explorer: `${ARC_TESTNET_EXPLORER}/address/${r.contractAddress}`,
});
