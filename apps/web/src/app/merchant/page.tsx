import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";
import { SavedDraftCard } from "@/components/merchant/SavedDraftCard";
import { WalletButton } from "@/components/wallet-button";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { formatTokenAmount } from "@/lib/format";

// Presentational only. No API is connected, so the overview figures show as unavailable. The one
// promotion card below is the labeled DEMO_PROMOTION fixture; it is not counted in any figure.
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
          <div className="flex shrink-0 flex-col gap-4 sm:items-end">
            {/* Navigation only. Nothing is created, published or claimed by clicking these. */}
            <nav
              aria-label="Merchant actions"
              className="flex shrink-0 flex-wrap items-center gap-3"
            >
              <Link
                href="/merchant/new"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              >
                <span aria-hidden className="h-2 w-2 rounded-sm bg-orange-400" />
                Create Promotion
              </Link>
              <Link
                href="/merchant/claims"
                className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              >
                Merchant Claims
              </Link>
            </nav>

            {/* Existing wallet adapter UI (connect / disconnect). Optional: the dashboard and demo
                work without it, and a connected wallet is not proof of owning any promotion. */}
            <div className="flex flex-col gap-1.5 sm:items-end">
              <WalletButton />
              <p className="max-w-xs text-xs leading-relaxed text-stone-500 sm:text-right">
                Connect a Solana Devnet wallet for future merchant transactions. Optional;
                connecting does not prove ownership of any promotion.
              </p>
            </div>
          </div>
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
          <p className="mt-1 text-sm text-stone-600">
            Live promotion data is not connected yet. Nothing below is a published or on-chain
            promotion, and none of it is counted in the overview.
          </p>

          {/* Client component: shows the draft saved in this browser session, if there is one. */}
          <SavedDraftCard />

          <p className="mt-6 text-xs font-medium uppercase tracking-wide text-stone-500">
            Sample promotion (fictional UI example)
          </p>
          <article className="mt-2 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold text-stone-900">
                  {DEMO_PROMOTION.name}
                </h3>
                <p className="mt-0.5 text-sm text-stone-500">{DEMO_PROMOTION.merchantName}</p>
              </div>
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-orange-800 ring-1 ring-inset ring-orange-300">
                Demo data
              </span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-stone-600">
              {DEMO_PROMOTION.description}
            </p>

            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-stone-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Purchase price
                </dt>
                <dd className="mt-1 text-lg font-semibold text-violet-900">
                  {formatTokenAmount(DEMO_PROMOTION.offerAmount)}
                </dd>
                <dd className="text-xs text-stone-500">mock USDC</dd>
              </div>
              <div className="rounded-lg bg-stone-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Refund condition
                </dt>
                <dd className="mt-1 break-words text-sm text-stone-800">
                  If {DEMO_PROMOTION.refundCondition}, the customer is refunded.
                </dd>
              </div>
              <div className="rounded-lg bg-stone-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Expires
                </dt>
                <dd className="mt-1 text-sm text-stone-800">
                  {new Date(DEMO_PROMOTION.expiresAt).toLocaleDateString("en-US", {
                    dateStyle: "long",
                    timeZone: "UTC",
                  })}{" "}
                  <span className="text-xs text-stone-500">(UTC)</span>
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-100 pt-4">
              {/* Navigation only: opens the demo checkout page. */}
              <Link
                href={`/checkout/${DEMO_PROMOTION.id}`}
                className="inline-flex items-center justify-center rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              >
                View Demo Checkout
              </Link>
              <p className="text-xs text-stone-500">
                Fictional example. Devnet test tokens only; hedging would be simulated.
              </p>
            </div>
          </article>
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
