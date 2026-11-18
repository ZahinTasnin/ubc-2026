/** Read-only check of Arc testnet + (if ARC_ESCROW_ADDRESS is set) the deployed escrow. No keys. */
import { createPublicClient, erc20Abi, http } from "viem";
import { ARC_TESTNET, ARC_TESTNET_RPC, ARC_USDC_ERC20, escrowAddressFromEnv } from "../src/config";
import { getConfig } from "../src/accounts";

const rpc = process.env.ARC_RPC_URL || ARC_TESTNET_RPC;
const pub = createPublicClient({ chain: ARC_TESTNET, transport: http(rpc) });
const [chainId, latest, finalized, gasPrice, dec, sym] = await Promise.all([
  pub.getChainId(),
  pub.getBlockNumber(),
  pub.getBlock({ blockTag: "finalized" }),
  pub.getGasPrice(),
  pub.readContract({ address: ARC_USDC_ERC20, abi: erc20Abi, functionName: "decimals" }),
  pub.readContract({ address: ARC_USDC_ERC20, abi: erc20Abi, functionName: "symbol" }),
]);
console.log({
  chainId,
  latest: latest.toString(),
  finalized: finalized.number?.toString(),
  gasPriceGwei: Number(gasPrice) / 1e9,
  usdcErc20: { address: ARC_USDC_ERC20, decimals: dec, symbol: sym },
});
const escrow = escrowAddressFromEnv(process.env);
if (escrow) console.log("escrow config", await getConfig(pub, escrow));
for (const a of process.argv.slice(2)) {
  if (/^0x[0-9a-fA-F]{40}$/.test(a))
    console.log(a, {
      nativeUsdc18: (await pub.getBalance({ address: a as `0x${string}` })).toString(),
    });
}
