import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SolanaProvider } from "@/components/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hedged Refund Promotions (Devnet demo)",
  description: "Simulation-first conditional refunds on Solana Devnet. Test tokens only.",
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
