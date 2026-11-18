import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";

// Presentational only. No API or fixture data is connected yet, so every figure shows as unavailable.
// TODO(Dev 1): wire to the REST API (GET /api/merchants/:id/dashboard) once Dev 4 documents the DTOs.

const OVERVIEW_CARDS = [
  { label: "Total Sales", hint: "Test-token purchases across your promotions" },
  { label: "Active Promotions", hint: "Offers currently accepting deposits" },
  { label: "Simulated Hedge Costs", hint: "Modeled premiums, not real trades" },
];

const STEPS = [
  {
    title: "Create a promotion",
    body: "Pick a prediction market outcome and set the refund offer for any product or service you sell.",
  },
  {
    title: "Customers purchase",
    body: "Customers pay with mock USDC on Solana Devnet. Funds are held in an on-chain escrow.",
  },
  {
    title: "A hedge is simulated",
    body: "Live Gemini market prices inform a simulated hedge. No real orders are placed.",
  },
  {
    title: "Outcome resolves",
    body: "After the market settles, customers or merchants claim the escrowed test tokens.",
  },
];

export default function MerchantPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <DevnetBanner />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <header className="flex flex-col gap-6 border-b border-stone-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
              <span className="tracking-tight text-violet-900">Wincentive</span>
            </Link>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
              Merchant Dashboard
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
              Manage outcome-based refund promotions: offer customers a refund if a real-world
              outcome goes their way, while tracking how the promotion is modeled to be hedged.
            </p>
          </div>
          {/* Navigation only: opens the draft form. Nothing is created or published by clicking. */}
          <Link
            href="/merchant/new"
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:self-auto"
          >
            <span aria-hidden className="h-2 w-2 rounded-sm bg-orange-400" />
            Create Promotion
          </Link>
        </header>

        {/* Overview */}
        <section aria-labelledby="overview-heading" className="mt-10">
          <h2
            id="overview-heading"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Overview
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {OVERVIEW_CARDS.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm font-medium text-stone-600">{card.label}</p>
                <p className="mt-3 text-3xl font-semibold text-stone-300" aria-label="Unavailable">
                  —
                </p>
                <p className="mt-2 text-xs text-stone-500">{card.hint}</p>
                <p className="mt-3 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                  Data not connected
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Promotions */}
        <section aria-labelledby="promotions-heading" className="mt-12">
          <h2 id="promotions-heading" className="text-xl font-semibold text-stone-900">
            Your Promotions
          </h2>
          <div className="mt-4 rounded-xl border border-dashed border-violet-300 bg-white px-6 py-14 text-center">
            <div
              aria-hidden
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-700"
            >
              ◇
            </div>
            <p className="mt-4 font-medium text-stone-900">No promotion data loaded yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
              Your promotions will appear here once the dashboard is connected to the backend.
            </p>
            {/* Navigation only: opens the draft form. */}
            <Link
              href="/merchant/new"
              className="mt-6 inline-flex items-center justify-center rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              Create Your First Promotion
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mt-12">
          <h2 id="how-heading" className="text-xl font-semibold text-stone-900">
            How It Works
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-stone-200 bg-white p-5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700">
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
