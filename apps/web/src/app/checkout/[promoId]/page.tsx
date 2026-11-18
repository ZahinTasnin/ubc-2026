import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";
import { DevnetNetworkNotice } from "@/components/wallet/DevnetNetworkNotice";
import { WalletButton } from "@/components/wallet-button";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Presentational checkout shell. No promotion API or deposit transaction is connected yet.
// Only the exact id "demo" shows the labeled DEMO_PROMOTION fixture; every other id keeps showing
// "Unavailable". Nothing here is a real offer, price, or quote, and no payment can be made.
// TODO(Dev 1): load the promotion via REST (GET /api/promotions/:id) once Dev 4 documents the DTOs.
// TODO(Dev 1): deposit flow via the @hedged/solana browser-safe transaction builders (Dev 3).

const STEPS = [
  {
    title: "Deposit into escrow",
    body: "You deposit mock USDC into a Solana escrow account. Neither the merchant nor Wincentive can spend it early.",
  },
  {
    title: "A hedge is simulated",
    body: "A live Gemini prediction-market quote informs a simulated hedge for the merchant. No real orders are placed.",
  },
  {
    title: "Outcome is finalized",
    body: "Once the market's official outcome is final, the escrow is settled once.",
  },
  {
    title: "Claim the escrowed tokens",
    body: "If the refund condition is met you claim your deposit back. Otherwise the merchant claims it.",
  },
];

export default async function CheckoutPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;

  // Only the exact demo id gets the fixture. Unknown ids never fall back to it.
  const demo = promoId === DEMO_PROMOTION.id ? DEMO_PROMOTION : null;
  // The example receipt link exists only for the demo promotion (and only if the fixtures match).
  const exampleReceiptId = demo && DEMO_PURCHASE.promotionId === demo.id ? DEMO_PURCHASE.id : null;

  const rows: { label: string; value: string | undefined }[] = [
    { label: "Promotion name", value: demo?.name },
    { label: "Merchant", value: demo?.merchantName },
    { label: "Product or service", value: demo?.description },
    {
      label: "Purchase price (mock USDC)",
      value: demo ? formatTokenAmount(demo.offerAmount) : undefined,
    },
    {
      label: "Refund condition",
      value: demo ? `If ${demo.refundCondition}, you are refunded.` : undefined,
    },
    {
      label: "Promotion expiration",
      value: demo
        ? `${new Date(demo.expiresAt).toLocaleDateString("en-US", {
            dateStyle: "long",
            timeZone: "UTC",
          })} (UTC)`
        : undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <DevnetBanner />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <header className="border-b border-stone-200 pb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
            <span className="tracking-tight text-violet-900">Wincentive</span>
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Promotion Checkout
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
            Buy with an outcome-based refund. This demo runs on <strong>Solana Devnet</strong> with
            valueless test tokens, and the merchant&apos;s hedge is <strong>simulated</strong>.
          </p>
        </header>

        {/* Promotion details */}
        <section
          aria-labelledby="details-heading"
          className="mt-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="details-heading" className="text-lg font-semibold text-stone-900">
              Promotion Details
            </h2>
            {demo ? (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-orange-800 ring-1 ring-inset ring-orange-300">
                Demo data
              </span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                Data not connected
              </span>
            )}
          </div>
          <p className="mt-1 break-all text-xs text-stone-500">
            Reference from link (unverified): <span className="font-mono">{promoId}</span>
          </p>

          {demo && (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900">
              <p className="font-medium">This is a fictional promotion for UI demonstration.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>It has not been published on-chain or saved to the backend.</li>
                <li>It has no real Gemini market associated with it.</li>
                <li>No payment can be made for this example.</li>
              </ul>
            </div>
          )}

          <dl className="mt-5 divide-y divide-stone-100">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <dt className="shrink-0 text-sm font-medium text-stone-600">{row.label}</dt>
                <dd className="min-w-0 break-words text-sm sm:text-right">
                  {row.value ? (
                    <span className="font-medium text-stone-900">{row.value}</span>
                  ) : (
                    <span className="text-stone-400">Unavailable</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Wallet */}
        <section
          aria-labelledby="wallet-heading"
          className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="wallet-heading" className="text-lg font-semibold text-stone-900">
            Connect Your Wallet
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">
            You need a Solana wallet set to <strong>Devnet</strong>. To check out you will also need
            mock USDC for the purchase and a little Devnet SOL for network fees. Both are free test
            tokens with no real value. Connecting a wallet does not start a payment.
          </p>
          <div className="mt-4">
            <WalletButton />
          </div>
          <DevnetNetworkNotice />
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mt-6">
          <h2 id="how-heading" className="text-lg font-semibold text-stone-900">
            How Your Refund Works
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
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

        {/* Checkout status */}
        <section
          aria-labelledby="status-heading"
          className="mt-6 rounded-xl border border-dashed border-violet-300 bg-white px-6 py-10 text-center"
        >
          <h2 id="status-heading" className="font-semibold text-stone-900">
            Checkout not available yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
            {demo
              ? "The demo promotion cannot accept deposits, and the Solana transaction SDK is not integrated yet, so no payment can be made."
              : "Promotion loading and the deposit transaction are not connected yet, so no payment can be made from this page."}
          </p>
          {demo && (
            <button
              type="button"
              disabled
              className="mt-5 cursor-not-allowed rounded-lg bg-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-500"
            >
              Pay with mock USDC
            </button>
          )}
          {exampleReceiptId && (
            <div className="mt-6 border-t border-stone-100 pt-5">
              {/* Navigation only: opens a fictional receipt. Nothing is purchased or paid. */}
              <Link
                href={`/purchases/${exampleReceiptId}`}
                className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              >
                View Example Receipt
              </Link>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-stone-500">
                The example receipt is fictional. No mock USDC deposit occurred, and viewing it does
                not make a purchase or process a payment. It only demonstrates how purchase status
                could be displayed in the future.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
