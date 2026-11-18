import localFont from "next/font/local";
import Link from "next/link";
import { DevnetNetworkNotice } from "@/components/wallet/DevnetNetworkNotice";
import { WalletButton } from "@/components/wallet-button";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Customer checkout. A Server Component. No promotion API or deposit transaction is connected yet.
// Only the exact id "demo" shows the labeled DEMO_PROMOTION fixture; every other id keeps showing
// "Unavailable" and never falls back to it. Nothing here is a real offer, price or quote, no real
// market is linked, and no payment can be made.
// TODO(Dev 1): load the promotion via REST (GET /api/promotions/:id) once Dev 4 documents the DTOs.
// TODO(Dev 1): deposit flow via the @hedged/solana browser-safe transaction builders (Dev 3).
//
// Styling follows the homepage, dashboard and Create Promotion page (page-scoped): same vendored
// fonts (../../fonts), colors and rhythm. The black logo artwork is shown only cropped to the W
// inside a black square, never recreated. NOTE: the file on disk is "wincentive-logo.png.png".
const LOGO_SRC = "/brand/wincentive-logo.png.png";

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
const BRAND_HAIRLINE = "bg-[linear-gradient(90deg,#6133A7,#B13BD8_38%,#F5539C_62%,#F58C38)]";

// The six details shown for an offer. Unknown ids show every one as "Unavailable".
const DETAIL_LABELS = [
  "Promotion name",
  "Merchant",
  "Product or service",
  "Purchase price (mock USDC)",
  "Refund condition",
  "Promotion expiration",
];

const STEPS = [
  {
    n: "01",
    title: "Deposit into escrow",
    body: "You deposit mock USDC into a Solana escrow account. Neither the merchant nor Wincentive can spend it early.",
  },
  {
    n: "02",
    title: "A hedge is simulated",
    body: "A live Gemini prediction-market quote informs a simulated hedge for the merchant. No real orders are placed.",
  },
  {
    n: "03",
    title: "Outcome is finalized",
    body: "Once the market's official outcome is final, the escrow is settled once.",
  },
  {
    n: "04",
    title: "Claim the escrowed tokens",
    body: "If the refund condition is met you claim your deposit back. Otherwise the merchant claims it.",
  },
];

/** The W from the supplied logo, zoomed into a black square. Decorative: the name sits beside it. */
function LogoMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`relative block shrink-0 overflow-hidden bg-black ${className}`}>
      <img
        src={LOGO_SRC}
        alt=""
        width={1536}
        height={1024}
        decoding="async"
        className="absolute left-1/2 top-1/2 h-auto w-[135%] max-w-none -translate-x-[52.7%] -translate-y-[46.1%]"
      />
    </span>
  );
}

function OutcomeIcon({ kind }: { kind: "yes" | "no" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 h-5 w-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.6" />
      {kind === "yes" ? (
        <path
          d="M6 10.4l2.7 2.7L14 7.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7 7l6 6M13 7l-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export default async function CheckoutPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;

  // Only the exact demo id gets the fixture. Unknown ids never fall back to it.
  const demo = promoId === DEMO_PROMOTION.id ? DEMO_PROMOTION : null;
  // The example receipt link exists only for the demo promotion (and only if the fixtures match).
  const exampleReceiptId = demo && DEMO_PURCHASE.promotionId === demo.id ? DEMO_PURCHASE.id : null;

  const price = demo ? formatTokenAmount(demo.offerAmount) : null;
  const expires = demo
    ? `${new Date(demo.expiresAt).toLocaleDateString("en-US", {
        dateStyle: "long",
        timeZone: "UTC",
      })} (UTC)`
    : null;

  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased`}
    >
      {/* Quiet disclosure strip (the full disclosure is in the footer) */}
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Devnet demo with valueless test tokens. Hedging is simulated.
      </p>

      {/* Header: same wordmark and rhythm as the other pages, with customer navigation. The wallet
          button lives in the checkout panel, where the wallet is actually relevant. */}
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:py-5">
        <Link href="/" aria-label="Wincentive home" className={`flex items-center gap-3 ${FOCUS}`}>
          <LogoMark className="h-10 w-10 rounded-[11px]" />
          <span className={`${DISPLAY} text-[1.35rem] font-bold tracking-[-0.03em]`}>
            Wincentive
          </span>
        </Link>
        <nav
          aria-label="Primary"
          className="flex items-center gap-x-6 text-sm font-medium md:gap-x-8 md:text-[15px]"
        >
          <a href="#how-it-works" className={`py-1.5 hover:text-[#6133A7] ${FOCUS}`}>
            How it works
          </a>
          <Link href="/merchant" className={`py-1.5 hover:text-[#6133A7] ${FOCUS}`}>
            For merchants
          </Link>
        </nav>
      </header>

      <main>
        {/* Intro */}
        <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-8 sm:px-8 lg:pb-10 lg:pt-8">
          <div className="max-w-3xl">
            <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6133A7]">
              <span aria-hidden className="h-[3px] w-8 rounded-full bg-[#F58C38]" />
              {demo ? "Your offer" : "Offer unavailable"}
            </p>
            <h1
              className={`${DISPLAY} mt-6 text-[clamp(2.5rem,5vw,4.2rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              {demo ? "A purchase with a possibility." : "We can’t show this offer yet."}
            </h1>
            <p className="mt-6 max-w-[36rem] text-lg leading-relaxed text-[#5A5463]">
              {demo
                ? "Shop as usual. If the selected event goes your way, your purchase may qualify for a refund."
                : "This link’s promotion isn’t connected, so no details are available and nothing can be purchased."}
            </p>
          </div>
        </section>

        <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-24">
          {/* The offer: the primary content */}
          <section aria-labelledby="details-heading" className="lg:col-span-7">
            {demo ? (
              <>
                <article
                  aria-label="Illustrative offer"
                  className="relative overflow-hidden rounded-[20px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-32px_rgba(33,29,40,0.3)]"
                >
                  <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
                  <div className="p-6 sm:p-8">
                    <span
                      aria-hidden
                      className="absolute right-6 top-9 h-3.5 w-3.5 rounded-full border-2 border-[#CFC8BC] sm:right-8"
                    />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-8">
                      <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                        Illustrative offer
                      </span>
                      <span className="text-xs font-semibold text-[#7A4208]">Demo data</span>
                    </div>

                    <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                      <div className="min-w-0 max-w-md">
                        <h2
                          id="details-heading"
                          className={`${DISPLAY} break-words text-[clamp(2rem,3.6vw,2.9rem)] font-semibold leading-[1.02] tracking-[-0.035em]`}
                        >
                          {demo.name}
                        </h2>
                        <p className="mt-2 text-sm text-[#5A5463]">{demo.merchantName}</p>
                        <p className="mt-3 text-[15px] leading-relaxed text-[#4E4858]">
                          {demo.description}
                        </p>
                      </div>
                      <div className="shrink-0 sm:text-right">
                        <p
                          className={`${DISPLAY} text-[3rem] font-semibold leading-none tracking-[-0.045em] tabular-nums`}
                        >
                          {price}
                        </p>
                        <p className="mt-1.5 text-xs text-[#5A5463]">mock USDC</p>
                      </div>
                    </div>

                    <div aria-hidden className="my-7 border-t border-dashed border-[#CFC8BC]" />

                    <p className="text-xs font-medium text-[#5A5463]">Refund condition</p>
                    <p
                      className={`${DISPLAY} mt-1 text-[1.5rem] font-semibold leading-snug tracking-[-0.02em]`}
                    >
                      If {demo.refundCondition}, you are refunded.
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
                      The merchant&apos;s own words. No real market is linked in this demo.
                    </p>

                    <dl className="mt-5 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                      <div className="flex gap-3 py-3.5 text-[#3F2A66]">
                        <OutcomeIcon kind="yes" />
                        <div className="min-w-0 flex-1 gap-x-6 sm:flex sm:justify-between">
                          <dt className="font-semibold">If the outcome happens</dt>
                          <dd className="mt-0.5 text-[#211D28] sm:mt-0 sm:text-right">
                            You claim your {price} back.
                          </dd>
                        </div>
                      </div>
                      <div className="flex gap-3 py-3.5 text-[#6B3A08]">
                        <OutcomeIcon kind="no" />
                        <div className="min-w-0 flex-1 gap-x-6 sm:flex sm:justify-between">
                          <dt className="font-semibold">If it doesn&apos;t</dt>
                          <dd className="mt-0.5 text-[#211D28] sm:mt-0 sm:text-right">
                            The merchant claims the escrowed {price}.
                          </dd>
                        </div>
                      </div>
                    </dl>

                    <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-[#5A5463]">Promotion expiration</dt>
                        <dd className="mt-1 font-medium">{expires}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#5A5463]">Market</dt>
                        <dd className="mt-1 font-medium">None linked in this demo</dd>
                      </div>
                    </dl>
                  </div>
                </article>

                <div className="mt-6 border-l-[3px] border-[#F58C38] pl-4 text-sm leading-relaxed text-[#4E4858]">
                  <p className="font-semibold text-[#211D28]">
                    This is a fictional promotion for UI demonstration.
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5">
                    <li>It has not been published on-chain or saved to the backend.</li>
                    <li>It has no real Gemini market associated with it.</li>
                    <li>No payment can be made for this example.</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="details-heading"
                    className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
                  >
                    Promotion details
                  </h2>
                  <span className="rounded-full bg-[#ECE8E0] px-3 py-1 text-xs font-bold text-[#4E4858]">
                    Data not connected
                  </span>
                </div>
                <dl className="mt-6 divide-y divide-[#E6E1D8] border-y-2 border-t-[#211D28] border-b-[#E6E1D8]">
                  {DETAIL_LABELS.map((label) => (
                    <div
                      key={label}
                      className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                    >
                      <dt className="shrink-0 text-sm font-medium text-[#5A5463]">{label}</dt>
                      <dd className="min-w-0 text-sm font-medium text-[#4E4858] sm:text-right">
                        Unavailable
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <p className="mt-6 break-all text-xs leading-relaxed text-[#5A5463]">
              Reference from link (unverified): <span className="font-mono">{promoId}</span>
            </p>
          </section>

          {/* Checkout: the narrower supporting column */}
          <aside aria-labelledby="checkout-heading" className="lg:col-span-5">
            <div className="rounded-[20px] border border-[#E6E1D8] bg-white p-5 sm:p-7">
              <h2
                id="checkout-heading"
                className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
              >
                Checkout
              </h2>

              {demo ? (
                <dl className="mt-5 text-sm">
                  <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
                    <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Item</dt>
                    <dd className="text-right font-medium">{demo.name}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
                    <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Merchant</dt>
                    <dd className="text-right font-medium">{demo.merchantName}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
                    <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Refundable if</dt>
                    <dd className="text-right font-medium">{demo.refundCondition}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t-2 border-[#211D28] pt-3.5">
                    <dt className="shrink-0 whitespace-nowrap font-semibold">Total (mock USDC)</dt>
                    <dd
                      className={`${DISPLAY} text-2xl font-semibold tracking-[-0.03em] tabular-nums`}
                    >
                      {price}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-[#5A5463]">
                  There is no purchase summary for this link.
                </p>
              )}

              {/* Wallet */}
              <section
                aria-labelledby="wallet-heading"
                className="mt-7 border-t border-[#E6E1D8] pt-6"
              >
                <h3 id="wallet-heading" className="text-sm font-semibold">
                  Connect Your Wallet
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#5A5463]">
                  You need a Solana wallet set to <strong>Devnet</strong>. To check out you will
                  also need mock USDC for the purchase and a little Devnet SOL for network fees.
                  Both are free test tokens with no real value. Connecting a wallet does not start a
                  payment.
                </p>
                {/* Existing wallet adapter button, restyled for this page only (class overrides). */}
                <div className="mt-4 [&_.wallet-adapter-button]:h-11! [&_.wallet-adapter-button]:rounded-full! [&_.wallet-adapter-button]:bg-[#211D28]! [&_.wallet-adapter-button]:px-6! [&_.wallet-adapter-button]:text-sm! [&_.wallet-adapter-button]:font-semibold! [&_.wallet-adapter-button]:font-[family-name:var(--font-body)]! [&_.wallet-adapter-button:hover]:bg-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-2! [&_.wallet-adapter-button:focus-visible]:outline-offset-4! [&_.wallet-adapter-button:focus-visible]:outline-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-solid!">
                  <WalletButton />
                </div>
                <DevnetNetworkNotice />
              </section>

              {/* Payment is unavailable */}
              <section
                aria-labelledby="status-heading"
                className="mt-7 border-t border-[#E6E1D8] pt-6"
              >
                {demo && (
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-[#E6E1D8] px-6 py-3.5 text-base font-semibold text-[#5A5463]"
                  >
                    Pay with mock USDC
                  </button>
                )}
                <h3
                  id="status-heading"
                  className={`${DISPLAY} ${demo ? "mt-4" : ""} text-lg font-semibold tracking-[-0.015em]`}
                >
                  Checkout not available yet
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#5A5463]">
                  {demo
                    ? "The demo promotion cannot accept deposits, and the Solana transaction SDK is not integrated yet, so no payment can be made."
                    : "Promotion loading and the deposit transaction are not connected yet, so no payment can be made from this page."}
                </p>

                {exampleReceiptId && (
                  <div className="mt-5 border-t border-[#E6E1D8] pt-5">
                    {/* Navigation only: opens a fictional receipt. Nothing is purchased or paid. */}
                    <Link
                      href={`/purchases/${exampleReceiptId}`}
                      className="inline-flex items-center justify-center rounded-full border border-[#211D28]/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:border-[#211D28] hover:bg-[#FAF9F6] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]"
                    >
                      View Example Receipt
                    </Link>
                    <p className="mt-3 text-[13px] leading-relaxed text-[#5A5463]">
                      <strong className="font-semibold text-[#211D28]">
                        An illustrative receipt, not evidence of a completed purchase.
                      </strong>{" "}
                      The example receipt is fictional. No mock USDC deposit occurred, and viewing
                      it does not make a purchase or process a payment. It only demonstrates how
                      purchase status could be displayed in the future.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>

        {/* After the outcome: what happens to the escrow */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-4 border-t border-[#E6E1D8]"
        >
          <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:py-24">
            <h2
              id="how-heading"
              className={`${DISPLAY} text-[clamp(2.2rem,4.6vw,3.4rem)] font-semibold leading-[1] tracking-[-0.04em]`}
            >
              How Your Refund Works
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-2 md:gap-x-0 md:gap-y-12 lg:grid-cols-4 lg:gap-y-0">
              {STEPS.map((step) => (
                <li
                  key={step.n}
                  className="relative border-l border-[#CFC8BC] pl-7 md:border-l-0 md:border-t md:pl-0 md:pr-8 md:pt-9"
                >
                  <span
                    aria-hidden
                    className="absolute -left-[5px] top-2 h-[9px] w-[9px] rounded-full bg-[#6133A7] md:-top-[5px] md:left-0"
                  />
                  <p
                    className={`${DISPLAY} text-[3.2rem] font-light leading-none tracking-[-0.05em] text-[#6133A7] tabular-nums`}
                  >
                    {step.n}
                  </p>
                  <h3 className={`${DISPLAY} mt-5 text-xl font-semibold tracking-[-0.02em]`}>
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
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
            <Link href="/merchant" className={`hover:text-[#6133A7] ${FOCUS}`}>
              For merchants
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
