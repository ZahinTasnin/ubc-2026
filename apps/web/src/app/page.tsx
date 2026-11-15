import Link from "next/link";
import { DEMO_PURCHASE_AMOUNT, MOCK_USD_DECIMALS } from "@hedged/shared";
import { DevnetBanner } from "@/components/devnet-banner";
import { WalletButton } from "@/components/wallet-button";

export default function Home() {
  return (
    <>
      <DevnetBanner />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Hedged Refund Promotions</h1>
          <WalletButton />
        </div>
        <p className="mt-6 text-lg text-neutral-700">
          “Buy a $5 coffee; if Texas wins, get your $5 back.” Escrowed on Solana Devnet; the
          merchant&apos;s hedge is modeled off-chain from live read-only Gemini Predictions data.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          Demo offer: {DEMO_PURCHASE_AMOUNT} base units ({MOCK_USD_DECIMALS} decimals) of a mock
          stablecoin.
        </p>
        <nav className="mt-10 flex gap-4">
          <Link className="rounded bg-neutral-900 px-4 py-2 text-white" href="/merchant">
            Merchant dashboard
          </Link>
          <Link className="rounded border px-4 py-2" href="/checkout/demo">
            Customer checkout
          </Link>
        </nav>
      </main>
    </>
  );
}
