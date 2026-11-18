import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";
import { WalletButton } from "@/components/wallet-button";

// Presentational checkout shell. No promotion API or deposit transaction is connected yet, so every
// promotion detail shows as unavailable. Nothing here is a real offer, price, or quote.
// TODO(Dev 1): load the promotion via REST (GET /api/promotions/:id) once Dev 4 documents the DTOs.
// TODO(Dev 1): deposit flow via the @hedged/solana browser-safe transaction builders (Dev 3).

const DETAILS = [
  { label: "Promotion name" },
  { label: "Product or service" },
  { label: "Purchase price" },
  { label: "Refund condition" },
  { label: "Promotion expiration" },
];

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
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
              Data not connected
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-stone-500">
            Reference from link (unverified): <span className="font-mono">{promoId}</span>
          </p>

          <dl className="mt-5 divide-y divide-stone-100">
            {DETAILS.map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-sm font-medium text-stone-600">{item.label}</dt>
                <dd className="text-sm text-stone-400">Unavailable</dd>
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
            tokens with no real value.
          </p>
          <div className="mt-4">
            <WalletButton />
          </div>
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
            Promotion loading and the deposit transaction are not connected yet, so no payment can
            be made from this page.
          </p>
        </section>
      </main>
    </div>
  );
}
