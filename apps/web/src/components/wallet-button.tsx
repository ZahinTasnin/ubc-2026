"use client";

import dynamic from "next/dynamic";

// Dynamic import avoids SSR hydration mismatch from the wallet UI.
export const WalletButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);
