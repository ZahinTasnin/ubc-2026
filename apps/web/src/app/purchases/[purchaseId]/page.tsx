import localFont from "next/font/local";
import Link from "next/link";
import type { PurchaseStatus, TokenBaseUnits } from "@hedged/shared";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DevnetNetworkNotice } from "@/components/wallet/DevnetNetworkNotice";
import { WalletButton } from "@/components/wallet-button";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Purchase receipt. A Server Component. No purchase API or on-chain read is connected yet.
// Only the exact id "demo" shows the labeled DEMO_PURCHASE fixture; every other id keeps showing
// "Unavailable" and never falls back to it. Nothing here is a real purchase or payment, no stage is
// verified on-chain, and no claim can be executed.
// TODO(Dev 1): load the purchase via REST (GET /api/purchases/:id) once Dev 4 documents the DTOs,
// and read on-chain state through @hedged/solana (Dev 3).
//
// Styling follows the homepage, dashboard, Create Promotion and Checkout pages (page-scoped): same
// vendored fonts (../../fonts), colors and rhythm. The black logo artwork is shown only cropped to
// the W inside a black square, never recreated. NOTE: the file on disk is
// "wincentive-logo.png.png" (double extension).
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

// The conceptual progression. Explanation only: no stage is complete for any record on this page.
// The "related" captions are the existing PurchaseStatus labels.
const TRACKING_STAGES = [
  {
    title: "Purchase submitted",
    body: "Customer deposits mock USDC into escrow",
    related: "Deposited",
  },
  {
    title: "Hedge recorded",
    body: "The backend verifies the deposit and simulates a Gemini hedge",
    related: "Hedge simulated, then Hedged once confirmed on-chain",
  },
  {
    title: "Outcome finalized",
    body: "The Gemini market reaches an officially finalized outcome",
    related: "Resolved",
  },
  {
    title: "Eligible party claims",
    body: "An eligible customer or merchant claims the escrowed mock USDC",
    related: "Claimed",
  },
];

// Which stage a status label sits at. Used ONLY to place the "illustrative" marker for the demo
// fixture (its status is flagged hypothetical). It never marks a stage as verified.
const STATUS_STAGE: Partial<Record<PurchaseStatus, number>> = {
  DEPOSITED: 0,
  PENDING_HEDGE: 1,
  HEDGE_SIMULATED: 1,
  HEDGED: 1,
  RESOLVED: 2,
  CLAIMED: 3,
};

// What each stage says when it is NOT verified (demo wording). The prefix says why it is not shown
// as done; the illustrative stage gets "Illustrative status only, not confirmed." instead.
const DEMO_STAGE_FACTS = [
  "No mock USDC was deposited for this record.",
  "No Gemini trading or hedge execution happened.",
  "No final market outcome exists for this record.",
  "Nothing can be claimed for this record.",
];
const DEMO_STAGE_PREFIX = [
  "Not verified. ",
  "Not confirmed. ",
  "Not available. ",
  "Not available. ",
];

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

/**
 * Timeline marker. There is deliberately NO solid "verified" marker: no stage on this page is
 * verified on-chain. "keyVerified" is a muted, outlined sample used only in the key to explain
 * what verified progress will look like once real data exists.
 */
function Marker({ kind }: { kind: "keyVerified" | "illustrative" | "none" }) {
  if (kind === "keyVerified") {
    return (
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[#CBBEE3] bg-white text-[#B7A6D6]"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
          <path
            d="M5 10.4l3.2 3.2L15 6.8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (kind === "illustrative") {
    return (
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-dashed border-[#F58C38] bg-[#FDEBD9]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#F58C38]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="block h-[22px] w-[22px] rounded-full border-2 border-[#A59E92] bg-[#FAF9F6]"
    />
  );
}

/** What the illustrative status does and does not mean. Rendered where it reads best per screen size. */
function AboutStatus() {
  return (
    <div>
      <h3 className={`${DISPLAY} text-lg font-semibold tracking-[-0.015em]`}>
        About the illustrative status
      </h3>
      <ul className="mt-2 max-w-xl list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-[#4E4858]">
        <li>
          &ldquo;Hedge simulated&rdquo; is a hypothetical UI scenario, not confirmed blockchain or
          backend state.
        </li>
        <li>No mock USDC was deposited.</li>
        <li>No Gemini trading or hedge execution happened.</li>
        <li>This purchase is not paid, confirmed or hedged.</li>
      </ul>
    </div>
  );
}

export default async function PurchaseReceiptPage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const { purchaseId } = await params;

  // Only the exact demo id gets the fixture. Unknown ids never fall back to it.
  const demo = purchaseId === DEMO_PURCHASE.id ? DEMO_PURCHASE : null;
  const promotion = demo && demo.promotionId === DEMO_PROMOTION.id ? DEMO_PROMOTION : null;

  // Real data is not loaded yet, so these are null unless the demo record is being shown.
  const status = (demo?.status ?? null) as PurchaseStatus | null;
  const amount = (demo?.amount ?? null) as TokenBaseUnits | null;
  const promotionName = promotion?.name ?? null;
  const illustrativeStage = status ? (STATUS_STAGE[status] ?? null) : null;

  const unavailable = <span className="text-[#5A5463]">Unavailable</span>;

  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased`}
    >
      {/* Quiet disclosure strip (the full disclosure is in the footer) */}
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Devnet demo with valueless test tokens. Hedging is simulated.
      </p>

      {/* Header: same wordmark and rhythm as the checkout page, with simple customer navigation */}
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
          <Link href="/checkout/demo" className={`py-1.5 hover:text-[#6133A7] ${FOCUS}`}>
            Demo checkout
          </Link>
          <Link href="/merchant" className={`py-1.5 hover:text-[#6133A7] ${FOCUS}`}>
            For merchants
          </Link>
        </nav>
      </header>

      <main>
        {/* Intro */}
        <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-4 sm:px-8 lg:pb-10">
          <div className="-my-3 flex flex-wrap items-center gap-x-6">
            {demo && (
              <Link
                href={`/checkout/${DEMO_PROMOTION.id}`}
                className={`inline-flex min-h-11 items-center text-sm font-medium text-[#6133A7] underline-offset-4 hover:underline ${FOCUS}`}
              >
                ← Back to checkout
              </Link>
            )}
            <Link
              href="/"
              className={`inline-flex min-h-11 items-center text-sm font-medium text-[#6133A7] underline-offset-4 hover:underline ${FOCUS}`}
            >
              ← Back to homepage
            </Link>
          </div>

          <div className="mt-6 max-w-3xl">
            <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6133A7]">
              <span aria-hidden className="h-[3px] w-8 rounded-full bg-[#F58C38]" />
              {demo ? "Illustrative receipt" : "Receipt unavailable"}
            </p>
            <h1
              className={`${DISPLAY} mt-5 text-[clamp(2.5rem,5vw,4.2rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              {demo ? "From purchase to possibility." : "We can’t show this receipt yet."}
            </h1>
            <p className="mt-5 max-w-[36rem] text-lg leading-relaxed text-[#5A5463]">
              {demo
                ? "See how a conditional refund would progress from checkout to settlement."
                : "This link’s purchase isn’t connected, so no purchase details, status or timeline are available."}
            </p>
          </div>
        </section>

        <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-20">
          {/* Left: the receipt and its progress */}
          <div className="lg:col-span-7">
            {/* Receipt summary */}
            <section aria-labelledby="details-heading">
              {demo ? (
                <article
                  aria-label="Illustrative receipt"
                  className="relative overflow-hidden rounded-[20px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-32px_rgba(33,29,40,0.3)]"
                >
                  <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
                  <div className="p-6 sm:p-8">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                        Demo data
                      </span>
                      <span className="text-xs font-semibold text-[#7A4208]">
                        This is not a real receipt
                      </span>
                    </div>
                    <h2 id="details-heading" className={`${DISPLAY} sr-only`}>
                      Purchase Details
                    </h2>

                    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#5A5463]">Promotion name</p>
                        <p
                          className={`${DISPLAY} mt-1 break-words text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.035em]`}
                        >
                          {promotionName ?? unavailable}
                        </p>
                      </div>
                      <div className="shrink-0 sm:text-right">
                        <p className="text-xs font-medium text-[#5A5463]">
                          Purchase amount (mock USDC)
                        </p>
                        <p
                          className={`${DISPLAY} mt-1 text-[3rem] font-semibold leading-none tracking-[-0.045em] tabular-nums`}
                        >
                          {amount ? formatTokenAmount(amount) : unavailable}
                        </p>
                        <p className="mt-1.5 text-xs text-[#5A5463]">
                          Devnet test tokens, not paid
                        </p>
                      </div>
                    </div>

                    <div aria-hidden className="my-7 border-t border-dashed border-[#CFC8BC]" />

                    <dl className="divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                      <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <dt className="shrink-0 text-[#5A5463]">Purchase reference</dt>
                        <dd className="min-w-0 font-medium sm:text-right">
                          <span className="break-all font-mono">{purchaseId}</span>
                          <span className="block text-xs font-normal text-[#5A5463]">
                            Fictional reference
                          </span>
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <dt className="shrink-0 text-[#5A5463]">Purchase date</dt>
                        <dd className="min-w-0 font-medium sm:text-right">
                          Not applicable — no purchase occurred
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <dt className="shrink-0 text-[#5A5463]">Solana transaction signature</dt>
                        <dd className="min-w-0 font-medium sm:text-right">
                          Not available — no transaction occurred
                        </dd>
                      </div>
                      <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                        <dt className="shrink-0 text-[#5A5463]">Purchase status</dt>
                        <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
                          {status && <StatusBadge status={status} />}
                          <span className="text-xs font-semibold text-[#7A4208]">
                            Illustrative status — not confirmed
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </article>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2
                      id="details-heading"
                      className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
                    >
                      Purchase Details
                    </h2>
                    <span className="rounded-full bg-[#ECE8E0] px-3 py-1 text-xs font-bold text-[#4E4858]">
                      Data not connected
                    </span>
                  </div>
                  <dl className="mt-6 divide-y divide-[#E6E1D8] border-y-2 border-t-[#211D28] border-b-[#E6E1D8] text-sm">
                    <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                      <dt className="shrink-0 text-[#5A5463]">Purchase reference</dt>
                      <dd className="min-w-0 font-medium sm:text-right">
                        <span className="break-all font-mono">{purchaseId}</span>
                        <span className="block text-xs font-normal text-[#5A5463]">
                          From the link, not verified
                        </span>
                      </dd>
                    </div>
                    {[
                      "Promotion name",
                      "Purchase amount (mock USDC)",
                      "Purchase date",
                      "Solana transaction signature",
                    ].map((label) => (
                      <div
                        key={label}
                        className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                      >
                        <dt className="shrink-0 text-[#5A5463]">{label}</dt>
                        <dd className="min-w-0 font-medium sm:text-right">{unavailable}</dd>
                      </div>
                    ))}
                    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <dt className="shrink-0 text-[#5A5463]">Purchase status</dt>
                      <dd className="flex min-w-0 flex-wrap items-center gap-3 sm:justify-end">
                        <span className="inline-flex items-center rounded-full bg-[#ECE8E0] px-2.5 py-0.5 text-xs font-medium text-[#4E4858] ring-1 ring-inset ring-[#CFC8BC]">
                          Status unavailable
                        </span>
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </section>

            {demo && (
              <div
                role="note"
                className="mt-6 border-l-[3px] border-[#F58C38] pl-4 text-sm leading-relaxed text-[#4E4858]"
              >
                <p className="font-semibold text-[#211D28]">
                  Demo data: this is not a real receipt
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  <li>This purchase is fictional, shown only to demonstrate the receipt layout.</li>
                  <li>No mock USDC deposit happened, and no wallet or transaction exists.</li>
                  <li>No Gemini hedge was executed and no real order was placed.</li>
                  <li>No refund or merchant claim can be executed for this record.</li>
                </ul>
              </div>
            )}

            {/* Purchase progress: a vertical timeline. Nothing on it is verified. */}
            <section
              id="tracking"
              aria-labelledby="tracking-heading"
              className="mt-14 border-t border-[#E6E1D8] pt-10"
            >
              <h2
                id="tracking-heading"
                className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
              >
                How Purchase Tracking Works
              </h2>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
                General explanation only. No stage is complete for this record.
              </p>

              {/* Key: illustrative stages are visibly different from verified on-chain progress. The
                  "verified" sample is muted and outlined, and unknown ids do not show it at all. */}
              <div
                role="group"
                aria-label="Timeline key"
                className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-3 border-y border-[#E6E1D8] py-3.5"
              >
                <p className="text-xs font-semibold text-[#5A5463] sm:pt-0.5">Key</p>
                <ul className="grid flex-1 gap-x-6 gap-y-3 text-xs text-[#4E4858] sm:grid-cols-3">
                  {demo && (
                    <li className="flex items-center gap-2.5">
                      <Marker kind="keyVerified" />
                      <span>
                        <span className="font-semibold text-[#211D28]">Verified on-chain</span>
                        <br />
                        None for this record
                      </span>
                    </li>
                  )}
                  {demo && (
                    <li className="flex items-center gap-2.5">
                      <Marker kind="illustrative" />
                      <span>
                        <span className="font-semibold text-[#211D28]">Illustrative</span>
                        <br />
                        For demonstration only
                      </span>
                    </li>
                  )}
                  <li className="flex items-center gap-2.5">
                    <Marker kind="none" />
                    <span>
                      <span className="font-semibold text-[#211D28]">Not verified</span>
                      <br />
                      Or not available
                    </span>
                  </li>
                </ul>
              </div>

              <ol className="mt-8">
                {TRACKING_STAGES.map((stage, i) => {
                  const isIllustrative = demo !== null && illustrativeStage === i;
                  return (
                    <li
                      key={stage.title}
                      className="relative ml-[10px] border-l border-[#CFC8BC] pb-9 pl-9 last:border-l-transparent last:pb-0"
                    >
                      <span className="absolute -left-[11px] top-0">
                        <Marker kind={isIllustrative ? "illustrative" : "none"} />
                      </span>
                      <h3
                        className={`${DISPLAY} text-xl font-semibold leading-tight tracking-[-0.02em]`}
                      >
                        {stage.title}
                      </h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-[#4E4858]">
                        {stage.body}
                      </p>
                      <p className="mt-1 text-xs text-[#5A5463]">Related status: {stage.related}</p>
                      <p
                        className={`mt-2 text-xs font-semibold ${
                          isIllustrative ? "text-[#7A4208]" : "text-[#5A5463]"
                        }`}
                      >
                        {demo
                          ? `${
                              isIllustrative && status
                                ? "Illustrative status only, not confirmed. "
                                : DEMO_STAGE_PREFIX[i]
                            }${DEMO_STAGE_FACTS[i]}`
                          : "Not available. No purchase data is connected."}
                      </p>
                      {isIllustrative && status && (
                        <div className="mt-2">
                          <StatusBadge status={status} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {demo && (
                <div className="mt-10 border-t border-[#E6E1D8] pt-6 lg:hidden">
                  <AboutStatus />
                </div>
              )}
              {!demo && (
                <p className="mt-10 max-w-xl border-t border-[#E6E1D8] pt-6 text-[15px] leading-relaxed text-[#4E4858] lg:hidden">
                  The current status will appear here once purchase data is connected. It will
                  reflect confirmed on-chain state, not a guess.
                </p>
              )}
            </section>
          </div>

          {/* Right: the claim area, a narrower supporting column */}
          <aside aria-labelledby="claim-heading" className="lg:col-span-5">
            <div className="rounded-[20px] border border-[#E6E1D8] bg-white p-5 sm:p-7">
              <h2
                id="claim-heading"
                className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
              >
                Claim Refund
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#5A5463]">
                Eligible customers will claim their mock USDC refund through a Solana wallet.
              </p>

              {/* Eligibility */}
              <section
                aria-labelledby="eligibility-heading"
                className="mt-6 border-t border-[#E6E1D8] pt-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="eligibility-heading" className="text-sm font-semibold">
                    Refund Eligibility
                  </h3>
                  <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                    {demo ? "Not verified" : "Not yet verified"}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[#5A5463]">
                  A refund is available only when the verified market outcome satisfies the
                  promotion&apos;s refund condition and the on-chain purchase is eligible.{" "}
                  {demo
                    ? "This demo record has no on-chain purchase, no official market outcome and no verified refund eligibility. Eligibility is not inferred from its illustrative status, and no funds are available to withdraw."
                    : "Eligibility has not been verified, and no funds have been returned."}
                </p>
              </section>

              {/* Wallet. Optional and separate from the claim action below: connecting never
                  enables Claim Refund, and a connected wallet is not proof of refund eligibility or
                  of owning this purchase. */}
              <section className="mt-6 border-t border-[#E6E1D8] pt-6">
                <h3 className="text-sm font-semibold">Wallet (optional)</h3>
                {/* Existing wallet adapter button, restyled for this page only (class overrides). */}
                <div className="mt-3 [&_.wallet-adapter-button]:h-11! [&_.wallet-adapter-button]:rounded-full! [&_.wallet-adapter-button]:bg-[#211D28]! [&_.wallet-adapter-button]:px-6! [&_.wallet-adapter-button]:text-sm! [&_.wallet-adapter-button]:font-semibold! [&_.wallet-adapter-button]:font-[family-name:var(--font-body)]! [&_.wallet-adapter-button:hover]:bg-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-2! [&_.wallet-adapter-button:focus-visible]:outline-offset-4! [&_.wallet-adapter-button:focus-visible]:outline-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-solid!">
                  <WalletButton />
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-[#5A5463]">
                  Connect your Solana wallet to claim eligible refunds when settlement is available.
                  Connecting does not enable a claim and is not proof of refund eligibility or of
                  owning this purchase.
                </p>
                {/* Read-only status of the app's RPC network. "Verified: Devnet" is NOT proof that
                    the wallet is on Devnet or that a refund can be claimed, and it has no effect on
                    the disabled Claim Refund button below. */}
                <DevnetNetworkNotice />
              </section>

              {/* The claim action: always disabled */}
              <section className="mt-6 border-t border-[#E6E1D8] pt-6">
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-[#E6E1D8] px-6 py-3.5 text-base font-semibold text-[#5A5463]"
                >
                  Claim Refund
                </button>
                <p className="mt-3 text-[13px] leading-relaxed text-[#5A5463]">
                  {demo
                    ? "Fictional purchases cannot execute refund transactions, so this button is disabled."
                    : "Claims are not connected yet, so this button is disabled."}
                </p>
              </section>
            </div>

            {/* Large screens: the explanation sits under the claim panel, balancing the columns */}
            <div className="mt-8 hidden border-t border-[#E6E1D8] pt-6 lg:block">
              {demo ? (
                <AboutStatus />
              ) : (
                <p className="text-[15px] leading-relaxed text-[#4E4858]">
                  The current status will appear here once purchase data is connected. It will
                  reflect confirmed on-chain state, not a guess.
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* Customer education: why a refund is not available, and what would decide it */}
        <section aria-labelledby="why-heading" className="border-t border-[#E6E1D8]">
          <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:py-20">
            <h2
              id="why-heading"
              className={`${DISPLAY} text-[clamp(2.1rem,4.2vw,3.2rem)] font-semibold leading-[1] tracking-[-0.04em]`}
            >
              Why a refund isn’t available
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
              {demo
                ? "This receipt is illustrative. It shows how a receipt would look. Nothing was purchased, paid or hedged, and no funds are involved."
                : "No purchase data is connected for this link, so there is nothing to show, track or claim."}
            </p>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0">
              {[
                {
                  title: "No deposit was made",
                  body: demo
                    ? "No mock USDC was deposited and no transaction exists, so there is nothing to refund."
                    : "No deposit or transaction can be shown for this link.",
                },
                {
                  title: "No outcome is final",
                  body: "A refund depends on the market’s official final outcome. None exists here, and a live score or price never counts.",
                },
                {
                  title: "What would decide it",
                  body: "In a real, integrated purchase: a verified on-chain purchase, the finalized outcome, and the promotion’s refund condition. A status label or a connected wallet never makes a purchase eligible.",
                },
              ].map((item) => (
                <li key={item.title} className="border-t border-[#CFC8BC] pt-6 md:pr-8">
                  <h3 className={`${DISPLAY} text-xl font-semibold tracking-[-0.02em]`}>
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">{item.body}</p>
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
            <Link href="/checkout/demo" className={`hover:text-[#6133A7] ${FOCUS}`}>
              Demo checkout
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
