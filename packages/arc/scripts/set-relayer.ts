/**
 * Admin rotates the relayer (reversible: rerun with the old address).
 *   ARC_ADMIN_KEY_PATH=~/.config/arc/ubc-deployer.json ARC_ESCROW_ADDRESS=0x... NEW_RELAYER=0x... \
 *   pnpm --filter @hedged/arc relayer:set [--dry-run]
 */
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { HEDGED_ESCROW_ABI } from "../src/abi";
import { ARC_TESTNET, ARC_TESTNET_RPC, escrowAddressFromEnv } from "../src/config";
import { loadArcAccount } from "../src/server/keys";

const rpc = process.env.ARC_RPC_URL || ARC_TESTNET_RPC;
const escrow = escrowAddressFromEnv(process.env);
if (!escrow) throw new Error("ARC_ESCROW_ADDRESS not set");
const admin = loadArcAccount(process.env.ARC_ADMIN_KEY_PATH ?? "", { label: "admin key" });
const next = getAddress(process.env.NEW_RELAYER ?? "");
const pub = createPublicClient({ chain: ARC_TESTNET, transport: http(rpc) });
const cur = await pub.readContract({
  address: escrow,
  abi: HEDGED_ESCROW_ABI,
  functionName: "relayer",
});
const onchainAdmin = await pub.readContract({
  address: escrow,
  abi: HEDGED_ESCROW_ABI,
  functionName: "admin",
});
console.log({
  escrow,
  admin: onchainAdmin,
  signer: admin.address,
  currentRelayer: cur,
  newRelayer: next,
});
if (onchainAdmin.toLowerCase() !== admin.address.toLowerCase())
  throw new Error("signer is not the escrow admin");
const { request } = await pub.simulateContract({
  address: escrow,
  abi: HEDGED_ESCROW_ABI,
  functionName: "setRelayer",
  args: [next],
  account: admin,
});
if (process.argv.includes("--dry-run")) {
  console.log("dry run OK (simulation passed); rerun without --dry-run to send");
  process.exit(0);
}
const hash = await createWalletClient({
  chain: ARC_TESTNET,
  transport: http(rpc),
  account: admin,
}).writeContract(request);
console.log({ tx: hash, status: (await pub.waitForTransactionReceipt({ hash })).status });
