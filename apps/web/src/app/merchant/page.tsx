import localFont from "next/font/local";
import Link from "next/link";
import { LogoMark } from "@/components/layout/LogoMark";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SavedDraftCard } from "@/components/merchant/SavedDraftCard";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { formatTokenAmount } from "@/lib/format";

// Merchant dashboard. A Server Component: no API is connected, so nothing here is live data.
// - "Demo draft" is the record SavedDraftCard reads from this browser session (client component).
// - "Illustrative sample" is the labeled DEMO_PROMOTION fixture. Neither is published or on-chain,
//   and neither is counted in any figure.
// TODO(Dev 1): wire to the REST API (GET /api/merchants/:id/dashboard) once Dev 4 documents the DTOs.
//
// Styling follows the homepage (page-scoped): same fonts (vendored in ../fonts), colors and rhythm.
// Header, wordmark and the cropped W logo come from src/components/layout (SiteHeader, LogoMark).

const display = localFont({
  src: "../fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  variable: "--font-display",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
const body = localFont({
  src: "../fonts/instrument-sans-latin.woff2",
  weight: "400 700",
  variable: "--font-body",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const DISPLAY = "font-[family-name:var(--font-display)]";
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] focus-visible:rounded-sm";

// Honest availability: these figures are not connected, so no value is shown for any of them.
const FIGURES = ["Total sales", "Active promotions", "Simulated hedge costs"];

// Merchant lifecycle. Only the first stage exists in this demo.
const LIFECYCLE = [
  {
    title: "Draft",
    body: "Set the price, refund condition, market ID and hedge limits. A draft is saved only in this browser session.",
    available: true,
  },
  {
    title: "Publish",
    body: "Sign with a Solana Devnet wallet to create the escrow. Connecting a wallet is optional here, and it does not prove ownership of any promotion.",
    available: false,
  },
  {
    title: "Go live",
    body: "Customers check out with valueless test tokens while the hedge is simulated.",
    available: false,
  },
  {
    title: "Claim",
    body: "Once the market's official outcome is final, the escrowed tokens are claimed by the customer or by you.",
    available: false,
  },
];

export default function MerchantPage() {
  const sample = DEMO_PROMOTION;
  const price = formatTokenAmount(sample.offerAmount);
  const expires = new Date(sample.expiresAt).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });

  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased`}
    >
      {/* Quiet disclosure strip (the full disclosure is in the footer) */}
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Devnet demo with valueless test tokens. Hedging is simulated.
      </p>

      <SiteHeader current="promotions" />

      <main>
        {/* Intro: headline and actions on the left, a quiet availability notice on the right */}
        <section className="mx-auto grid max-w-[1240px] gap-10 px-5 pb-12 pt-8 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-14 lg:pt-12">
          <div className="lg:col-span-8">
            <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6133A7]">
              <span aria-hidden className="h-[3px] w-8 rounded-full bg-[#F58C38]" />
              Merchant workspace
            </p>
            <h1
              className={`${DISPLAY} mt-6 text-[clamp(2.7rem,5.4vw,4.4rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              Make every offer an event.
            </h1>
            <p className="mt-6 max-w-[38rem] text-lg leading-relaxed text-[#5A5463]">
              Draft outcome-based refund offers, preview how customers will see them, and see what
              comes next. Everything here runs on Solana Devnet with valueless test tokens, and
              hedging is simulated.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/merchant/new"
                className="inline-flex items-center justify-center rounded-full bg-[#6133A7] px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#4E2890] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]"
              >
                Create promotion
              </Link>
              <Link
                href="/merchant/claims"
                className="inline-flex items-center justify-center rounded-full border border-[#211D28]/30 px-7 py-3.5 text-base font-semibold text-[#211D28] transition-colors hover:border-[#211D28] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]"
              >
                View claims
              </Link>
            </div>
          </div>

          {/* Live figures: honest availability notice, deliberately quiet (no values, no tiles) */}
          <section aria-labelledby="figures-heading" className="lg:col-span-4 lg:self-end">
            <h2 id="figures-heading" className="text-sm font-semibold">
              Live figures
            </h2>
            <dl className="mt-3 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
              {FIGURES.map((label) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[#5A5463]">{label}</dt>
                  <dd className="font-medium">Not connected</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-[#5A5463]">
              Live totals are not connected yet. Nothing on this page counts toward them.
            </p>
          </section>
        </section>

        <div aria-hidden className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <div className="border-t border-[#E6E1D8]" />
        </div>

        {/* Promotion workspace (primary focus) + lifecycle (secondary) */}
        <section
          aria-labelledby="workspace-heading"
          className="mx-auto grid max-w-[1240px] gap-14 px-5 py-14 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:py-16"
        >
          <div className="lg:col-span-8">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <h2
                id="workspace-heading"
                className={`${DISPLAY} text-[clamp(2rem,4vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]`}
              >
                Your promotions
              </h2>
              <Link
                href="/merchant/new"
                className={`text-sm font-semibold text-[#6133A7] underline underline-offset-4 hover:text-[#4E2890] ${FOCUS}`}
              >
                Create promotion
              </Link>
            </div>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
              Live promotion data is not connected yet. Nothing below is published or on-chain.
              Drafts you save in the form appear here for this browser session.
            </p>

            {/* Editorial record list: a demo draft (if one was saved), then the illustrative sample */}
            <div className="mt-8 border-t-2 border-[#211D28]">
              {/* Client component: renders nothing unless a valid draft is in this session. */}
              <SavedDraftCard />

              <article
                aria-label="Illustrative sample promotion"
                className="border-b border-l-[3px] border-b-[#E6E1D8] border-l-[#F58C38] py-8 pl-5 sm:pl-7"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                  <div className="min-w-0 max-w-xl">
                    <span className="inline-block rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                      Illustrative sample
                    </span>
                    <h3
                      className={`${DISPLAY} mt-3 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em]`}
                    >
                      {sample.name}
                    </h3>
                    <p className="mt-1 text-sm text-[#5A5463]">{sample.merchantName}</p>
                    <p className="mt-3 text-[15px] leading-relaxed text-[#4E4858]">
                      {sample.description}
                    </p>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p
                      className={`${DISPLAY} text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums`}
                    >
                      {price}
                    </p>
                    <p className="mt-1.5 text-xs text-[#5A5463]">mock USDC</p>
                  </div>
                </div>

                <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[#5A5463]">Refund condition</dt>
                    <dd className="mt-1 font-medium">
                      If {sample.refundCondition}, the customer is refunded.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#5A5463]">Expires</dt>
                    <dd className="mt-1 font-medium">{expires} (UTC)</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#5A5463]">Market</dt>
                    <dd className="mt-1 font-medium">None linked in this demo</dd>
                  </div>
                </dl>

                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  {/* Navigation only: opens the demo checkout page. */}
                  <Link
                    href={`/checkout/${sample.id}`}
                    className="inline-flex items-center justify-center rounded-full border border-[#211D28]/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:border-[#211D28] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]"
                  >
                    View Demo Checkout
                  </Link>
                  <p className="max-w-xs text-xs leading-relaxed text-[#5A5463]">
                    Fictional example, not a published or on-chain promotion. Devnet test tokens
                    only; hedging would be simulated.
                  </p>
                </div>
              </article>
            </div>
          </div>

          {/* Secondary: what happens next (a sequence, so it is numbered by a rail of nodes) */}
          <aside aria-labelledby="next-heading" className="lg:col-span-4 lg:pl-6">
            <h2
              id="next-heading"
              className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
            >
              What happens next
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">
              A promotion moves through four stages. Only the first exists in this demo.
            </p>
            <ol className="mt-7">
              {LIFECYCLE.map((step) => (
                <li
                  key={step.title}
                  className="relative ml-1 border-l border-[#CFC8BC] pb-8 pl-7 last:border-l-transparent last:pb-0"
                >
                  <span
                    aria-hidden
                    className={`absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full ${
                      step.available ? "bg-[#6133A7]" : "border border-[#A59E92] bg-[#FAF9F6]"
                    }`}
                  />
                  <h3
                    className={`${DISPLAY} text-lg font-semibold leading-snug tracking-[-0.015em]`}
                  >
                    {step.title}
                  </h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-[#5A5463]">{step.body}</p>
                  <p
                    className={`mt-2 text-xs font-semibold ${
                      step.available ? "text-[#6133A7]" : "text-[#5A5463]"
                    }`}
                  >
                    {step.available ? "Available in this demo" : "Not connected yet"}
                  </p>
                </li>
              ))}
            </ol>
          </aside>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E6E1D8] bg-white">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-10 sm:px-8 md:grid-cols-12 md:gap-8">
          <div className="flex items-start gap-3 md:col-span-4">
            <LogoMark className="h-11 w-11 rounded-xl" />
            <div>
              <p className={`${DISPLAY} text-lg font-bold tracking-[-0.02em]`}>Wincentive</p>
              <p className="mt-0.5 text-sm text-[#5A5463]">Outcome-powered commerce.</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-[#4E4858] md:col-span-5">
            Solana Devnet demonstration. Valueless test tokens. Gemini market data is read-only, and
            hedge execution is simulated. No real-money transactions or Gemini orders.
          </p>
          <nav
            aria-label="Footer"
            className="flex flex-col gap-2 text-sm font-medium md:col-span-3 md:items-end"
          >
            <Link href="/" className={`hover:text-[#6133A7] ${FOCUS}`}>
              Home
            </Link>
            <Link href="/merchant/claims" className={`hover:text-[#6133A7] ${FOCUS}`}>
              Claims
            </Link>
            <Link href="/checkout/demo" className={`hover:text-[#6133A7] ${FOCUS}`}>
              Demo checkout
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
