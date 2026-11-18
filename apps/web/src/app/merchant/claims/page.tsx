import localFont from "next/font/local";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { LogoMark } from "@/components/layout/LogoMark";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DevnetNetworkNotice } from "@/components/wallet/DevnetNetworkNotice";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Merchant claims. A Server Component. No settlement API or on-chain read is connected yet. The one
// settlement record is the labeled DEMO_PURCHASE fixture: fictional, never counted in the overview,
// and never claimable. Nothing here is real data.
// TODO(Dev 1): load settlements via REST once Dev 4 documents the DTOs, and verify claim
// eligibility from on-chain purchase + promo state via @hedged/solana (Dev 3). Off-chain status
// alone (e.g. RESOLVED) must never decide whether a merchant can claim.
//
// Styling follows the homepage and merchant dashboard (page-scoped): same vendored fonts
// (../../fonts), colors and rhythm. Header, wordmark and the cropped W logo come from
// src/components/layout (SiteHeader, LogoMark).

const display = localFont({
  src: "../../fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  variable: "--font-display",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
const body = localFont({
  src: "../../fonts/instrument-sans-latin.woff2",
  weight: "400 700",
  variable: "--font-body",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const DISPLAY = "font-[family-name:var(--font-display)]";
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] focus-visible:rounded-sm";

// Honest availability: these figures are not connected, so no value is shown for any of them.
const OVERVIEW = [
  { label: "Awaiting resolution", hint: "Purchases whose market outcome is not final yet" },
  { label: "Potentially claimable", hint: "Must still be verified against on-chain state" },
  { label: "Completed claims", hint: "Merchant claims confirmed on-chain" },
];

export default function MerchantClaimsPage() {
  // The fictional demo purchase is ALWAYS shown as not eligible, and Claim Funds stays disabled.
  // TODO(Dev 1): for real data, merchant claim eligibility must come from verified on-chain state
  // (purchase + promo accounts) together with the finalized market outcome, never from these demo
  // flags or from an off-chain PurchaseStatus such as RESOLVED. Customer refund eligibility is a
  // separate outcome and must not gate the merchant claim.
  const promotionName =
    DEMO_PURCHASE.promotionId === DEMO_PROMOTION.id ? DEMO_PROMOTION.name : "Unavailable";

  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased`}
    >
      {/* Quiet disclosure strip (the full disclosure is in the footer) */}
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Devnet demo with valueless test tokens. Hedging is simulated.
      </p>

      {/* Shared header. Its wallet button is optional: this page and its demo record work without it,
          and Claim Funds stays disabled whether or not a wallet is connected. */}
      <SiteHeader current="claims" />

      <main>
        {/* One grid, one DevnetNetworkNotice. Desktop: intro and utility share row 1, the workspace
            and claim column share row 3. Mobile (DOM order): intro, settlement record, wallet and
            network utility, then the claim panel, so the record comes first and the notice sits
            right before Claim Funds. */}
        <div className="mx-auto grid max-w-[1240px] gap-y-9 px-5 pb-10 pt-3 sm:px-8 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-0 lg:pb-16 lg:pt-6">
          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1 lg:pb-12">
            <Link
              href="/merchant"
              className={`-my-3 inline-flex min-h-11 items-center text-sm font-medium text-[#6133A7] underline-offset-4 hover:underline ${FOCUS}`}
            >
              ← Back to Merchant Dashboard
            </Link>

            <p className="mt-5 flex items-center gap-3 text-xs font-bold lg:mt-6 uppercase tracking-[0.18em] text-[#6133A7]">
              <span aria-hidden className="h-[3px] w-8 rounded-full bg-[#F58C38]" />
              Settlements &amp; claims
            </p>
            <h1
              className={`${DISPLAY} mt-4 text-[clamp(2.5rem,5vw,4.1rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              Every outcome, accounted for.
            </h1>
            <p className="mt-4 max-w-[34rem] text-base leading-relaxed text-[#5A5463] sm:text-lg">
              Review promotion outcomes and see when merchant funds become eligible to claim.
            </p>
          </div>

          <div
            aria-hidden
            className="hidden border-t border-[#E6E1D8] lg:col-span-12 lg:row-start-2 lg:mb-16 lg:block"
          />

          {/* The settlement workspace: the main focus */}
          <section
            aria-labelledby="settlements-heading"
            className="lg:col-span-7 lg:col-start-1 lg:row-start-3"
          >
            <h2
              id="settlements-heading"
              className={`${DISPLAY} text-[clamp(2rem,4vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]`}
            >
              Purchase Settlements
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
              Live settlement data is not connected yet. The only record below is a fictional
              example.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                Demo data
              </span>
              <span className="text-xs text-[#5A5463]">
                Fictional purchase. Not counted in the overview.
              </span>
            </div>

            {/* Editorial record list, in the dashboard's ruled-record language */}
            <div className="mt-4 border-t-2 border-[#211D28]">
              <article
                aria-label="Illustrative settlement record"
                className="border-b border-l-[3px] border-b-[#E6E1D8] border-l-[#F58C38] py-8 pl-5 sm:pl-7"
              >
                <span className="inline-block rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                  Illustrative data
                </span>

                <dl>
                  <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                    <div className="min-w-0">
                      <dt className="text-xs text-[#5A5463]">Promotion</dt>
                      <dd
                        className={`${DISPLAY} mt-1 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em]`}
                      >
                        {promotionName}
                      </dd>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <dt className="text-xs text-[#5A5463]">Purchase amount</dt>
                      <dd
                        className={`${DISPLAY} mt-1 text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums`}
                      >
                        {formatTokenAmount(DEMO_PURCHASE.amount)}
                      </dd>
                      <dd className="mt-1.5 text-xs text-[#5A5463]">mock USDC, not paid</dd>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-[#E6E1D8] pt-5">
                    <dt className="text-xs text-[#5A5463]">Purchase reference</dt>
                    <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                      <span>
                        <span className="font-mono font-medium">{DEMO_PURCHASE.id}</span>{" "}
                        <span className="text-[#5A5463]">(fictional)</span>
                      </span>
                      <Link
                        href={`/purchases/${DEMO_PURCHASE.id}`}
                        className={`font-semibold text-[#6133A7] underline underline-offset-4 hover:text-[#4E2890] ${FOCUS}`}
                      >
                        View Demo Receipt
                      </Link>
                    </dd>
                    <dd className="mt-1 text-xs text-[#5A5463]">
                      Illustrative receipt, not proof of payment
                    </dd>
                  </div>

                  {/* The three states that must never be confused */}
                  <div className="mt-6 grid gap-x-8 gap-y-6 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-[#5A5463]">Market outcome</dt>
                      <dd className="mt-1 font-medium">Not verified</dd>
                      <dd className="mt-1.5 text-xs font-semibold text-[#5A5463]">
                        Unverified: no outcome is final
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-[#5A5463]">Purchase status</dt>
                      <dd className="mt-1">
                        <StatusBadge status={DEMO_PURCHASE.status} />
                      </dd>
                      <dd className="mt-1.5 text-xs font-semibold text-[#7A4208]">
                        Illustrative, not confirmed
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-[#5A5463]">Claim eligibility</dt>
                      <dd className="mt-1 font-medium">Not eligible — demo only</dd>
                      <dd className="mt-1 text-xs text-[#5A5463]">
                        No deposit, no finalized outcome, claim unverified
                      </dd>
                      <dd className="mt-1.5 text-xs font-semibold text-[#5A5463]">
                        Live eligibility is not connected
                      </dd>
                    </div>
                  </div>
                  <div
                    role="note"
                    className="mt-6 border-t border-[#E6E1D8] pt-5 text-sm leading-relaxed text-[#4E4858]"
                  >
                    <p className="font-semibold text-[#211D28]">About this demo row</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                      <li>
                        &ldquo;Hedge simulated&rdquo; is a hypothetical status for illustration, not
                        confirmed state.
                      </li>
                      <li>No mock USDC deposit actually occurred.</li>
                      <li>No Gemini market outcome has been verified.</li>
                      <li>No purchase settlement has occurred.</li>
                      <li>This data does not represent confirmed on-chain activity.</li>
                    </ul>
                  </div>
                </dl>
              </article>
            </div>
          </section>

          {/* Utility area. Read-only status of the app's RPC network. A verified Devnet RPC is NOT
              proof of merchant authorization or claim eligibility, and says nothing about the
              wallet's own network. It has no effect on the disabled Claim Funds button. */}
          <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:self-end lg:pb-12">
            <p className="text-sm font-semibold">Wallet and network</p>
            <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
              Merchants will use their wallets for future claims. Connecting is optional and does
              not enable any claim.
            </p>
            <DevnetNetworkNotice />
          </div>

          {/* Supporting column: the claim action, then the quiet overview */}
          <aside className="lg:col-span-5 lg:col-start-8 lg:row-start-3">
            <section
              aria-labelledby="claim-heading"
              className="rounded-[20px] border border-[#E6E1D8] bg-white p-5 sm:p-7"
            >
              <h2
                id="claim-heading"
                className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
              >
                Merchant Claim
              </h2>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-[#4E4858]">
                <li>Customers deposit mock USDC into Solana escrow when they purchase.</li>
                <li>Gemini provides the officially finalized prediction-market outcome.</li>
                <li>
                  If the refund condition does not occur, you can claim the escrowed test tokens for
                  that purchase.
                </li>
                <li>
                  Eligibility must be verified against the on-chain purchase and promotion state. A
                  status shown by the app is not enough on its own.
                </li>
                <li>
                  The simulated Gemini hedge ledger is separate from the real Solana escrow. No
                  funds move between them.
                </li>
                <li>
                  Connecting a wallet does not prove you are the merchant. A real claim is signed by
                  the promotion&apos;s merchant.
                </li>
              </ul>
              <button
                type="button"
                disabled
                className="mt-6 inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-[#E6E1D8] px-6 py-3.5 text-base font-semibold text-[#5A5463]"
              >
                Claim Funds
              </button>
              <p className="mt-3 text-[13px] leading-relaxed text-[#5A5463]">
                Claims are not connected yet, so this button is disabled.
              </p>
            </section>

            {/* Settlement overview: honest and quiet. No values, no totals, no tiles. */}
            <section aria-labelledby="overview-heading" className="mt-10">
              <h2 id="overview-heading" className="text-sm font-semibold">
                Settlement Overview
              </h2>
              <dl className="mt-3 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                {OVERVIEW.map((item) => (
                  <div key={item.label} className="py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="font-medium">{item.label}</dt>
                      <dd className="text-right text-[#5A5463]">Data not connected</dd>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#5A5463]">{item.hint}</p>
                  </div>
                ))}
              </dl>
            </section>
          </aside>
        </div>
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
            <Link href="/merchant" className={`hover:text-[#6133A7] ${FOCUS}`}>
              Promotions
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
