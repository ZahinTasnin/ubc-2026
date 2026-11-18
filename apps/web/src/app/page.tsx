import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";
import { WalletButton } from "@/components/wallet-button";

// Static marketing/intro page. No data is loaded; nothing here is a real offer, price or result.

const HOW_IT_WORKS = [
  {
    title: "Merchants create promotions",
    body: "Pick an event, set the price and refund condition, and choose limits for the simulated hedge. Any product or service works.",
  },
  {
    title: "Deposits go to escrow",
    body: "Customer deposits are designed around Solana escrow, so funds are held by the program rather than by either side.",
  },
  {
    title: "Market prices inform a simulated hedge",
    body: "Read-only Gemini prediction-market prices feed cost estimates for a simulated hedge. No real orders are placed.",
  },
  {
    title: "The final outcome decides claims",
    body: "After the event's outcome is officially finalized, eligible customers claim their refund, or the merchant claims the escrowed tokens.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50">
      <DevnetBanner />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-base font-semibold">
            <span aria-hidden className="h-3 w-3 rounded-sm bg-orange-500" />
            <span className="tracking-tight text-violet-900">Wincentive</span>
          </span>
          <WalletButton />
        </div>

        {/* Hero */}
        <section className="mt-12 sm:mt-16">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-5xl">
            Refund promotions that depend on real-world outcomes
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">
            Wincentive helps merchants create outcome-based refund promotions for any product or
            service. If an event finishes a certain way, eligible customers can get their purchase
            back. Prediction-market prices help estimate what the merchant&apos;s hedge would cost.
          </p>

          <nav aria-label="Get started" className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              <span aria-hidden className="h-2 w-2 rounded-sm bg-orange-400" />
              Merchant Dashboard
            </Link>
            <Link
              href="/checkout/demo"
              className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              Demo Checkout
            </Link>
          </nav>
        </section>

        {/* Demo scope */}
        <section
          aria-labelledby="scope-heading"
          className="mt-10 rounded-xl border-2 border-orange-300 bg-orange-50 p-5 sm:p-6"
        >
          <h2
            id="scope-heading"
            className="text-sm font-bold uppercase tracking-wide text-orange-900"
          >
            Devnet demonstration
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-orange-900">
            <li>This app runs on Solana Devnet with valueless test tokens.</li>
            <li>Gemini market data is read-only, and the hedging is simulated.</li>
            <li>No real money moves, no real orders are placed, and no result is guaranteed.</li>
          </ul>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mt-12">
          <h2 id="how-heading" className="text-xl font-semibold text-stone-900">
            How It Works
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-stone-200 bg-white p-5">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700"
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 font-semibold text-stone-900">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
