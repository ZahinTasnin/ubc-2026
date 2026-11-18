"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

// Read-only network status. It makes ONE getGenesisHash call to the app's configured RPC (no
// polling) and compares it with known cluster genesis hashes.
//
// What this does and does NOT verify:
// - It verifies the network of the APPLICATION'S RPC endpoint only.
// - It does NOT verify the network the user's WALLET is set to. The installed wallet adapter
//   exposes no selected-network information (useWallet() has no network/cluster field, and the
//   Wallet Standard `chains` list only says what an account supports, not what is selected).
//   So the wallet network is always shown as "not verified". Never guess it from the RPC.

// Genesis hashes of the public Solana clusters. Checked on 2026-11-18 by calling getGenesisHash
// on https://api.devnet.solana.com, https://api.testnet.solana.com and
// https://api.mainnet-beta.solana.com; the three answers were distinct and match these values.
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const OTHER_CLUSTER_NAMES: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "Mainnet Beta",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "Testnet",
};

type RpcCheck =
  | { state: "checking" }
  | { state: "devnet" }
  | { state: "other"; name: string | null } // a different or unrecognized network
  | { state: "unknown" }; // the check failed

/** Maps a genesis hash from the RPC to a result. Only the exact Devnet hash counts as Devnet. */
export function classifyGenesisHash(hash: string): RpcCheck {
  if (hash === DEVNET_GENESIS_HASH) return { state: "devnet" };
  return { state: "other", name: OTHER_CLUSTER_NAMES[hash] ?? null };
}

const PILL =
  "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset";

export function DevnetNetworkNotice() {
  const { connection } = useConnection();
  const { wallet, connected } = useWallet();
  const [rpc, setRpc] = useState<RpcCheck>({ state: "checking" });

  // Runs once per connection object (the provider's endpoint is constant), not on a timer.
  useEffect(() => {
    let cancelled = false;
    connection
      .getGenesisHash()
      .then((hash) => {
        if (!cancelled) setRpc(classifyGenesisHash(hash));
      })
      .catch(() => {
        if (!cancelled) setRpc({ state: "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  return (
    <section
      aria-label="Solana network status"
      className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5"
    >
      {/* Always visible: the two statuses that matter. A warning here is never hidden. */}
      <dl className="space-y-1.5 text-xs">
        {/* App RPC network: the only thing actually checked */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="font-medium text-stone-700">App RPC network</dt>
          <dd
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            role="status"
            aria-live="polite"
          >
            {rpc.state === "checking" && (
              <span className={`${PILL} bg-stone-100 text-stone-700 ring-stone-300`}>
                Checking…
              </span>
            )}
            {rpc.state === "devnet" && (
              <span className={`${PILL} bg-emerald-100 text-emerald-900 ring-emerald-300`}>
                Verified: Devnet
              </span>
            )}
            {rpc.state === "other" && (
              <>
                <span className={`${PILL} bg-amber-100 text-amber-900 ring-amber-300`}>
                  Warning: not Devnet
                </span>
                <span className="font-medium text-amber-900">
                  RPC is on {rpc.name ?? "an unrecognized network"}. Do not make transactions.
                </span>
              </>
            )}
            {rpc.state === "unknown" && (
              <>
                <span className={`${PILL} bg-stone-100 text-stone-700 ring-stone-300`}>
                  Unable to verify
                </span>
                <span className="text-stone-600">The network is unknown.</span>
              </>
            )}
          </dd>
        </div>

        {/* Wallet network: not verifiable with the installed adapter, so always "Not verified" */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="font-medium text-stone-700">Wallet network</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`${PILL} bg-orange-100 text-orange-900 ring-orange-300`}>
              Not verified
            </span>
            <span className="text-stone-600">(wallets don&apos;t share it)</span>
          </dd>
        </div>
      </dl>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-violet-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
          Details and Devnet setup
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-stone-600">
          <p>
            <span className="font-medium text-stone-700">Connected wallet:</span>{" "}
            {connected && wallet ? `Connected: ${wallet.adapter.name}` : "No wallet connected"}
          </p>
          <p>
            <span className="font-medium text-stone-700">App RPC network</span> is the network this
            app reads from, and it is checked.{" "}
            <span className="font-medium text-stone-700">Wallet network</span> is the network your
            wallet is set to. Wallets don&apos;t tell this app, so it cannot be checked. A verified
            app RPC does not mean your wallet is on Devnet.
          </p>
          <p>
            Wincentive uses Solana Devnet. Ensure your wallet is configured for Devnet before making
            test transactions.
          </p>
        </div>
      </details>
    </section>
  );
}
