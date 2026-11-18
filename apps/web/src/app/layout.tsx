import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SolanaProvider } from "@/components/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wincentive",
  description:
    "Outcome-based refund promotions for merchants, informed by prediction-market prices. A Solana Devnet demo with valueless test tokens and simulated hedging.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
