import Link from "next/link";
import type { PurchaseStatus, TokenBaseUnits } from "@hedged/shared";
import { DevnetBanner } from "@/components/devnet-banner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatTokenAmount } from "@/lib/format";

// Presentational receipt shell. No purchase API or on-chain read is connected yet, so every value
// below is null and the page shows "Unavailable". Nothing here is a real purchase or payment.
// TODO(Dev 1): load the purchase via REST (GET /api/purchases/:id) once Dev 4 documents the DTOs,
// and read on-chain state through @hedged/solana (Dev 3). The status and amount are typed so the
// existing StatusBadge / formatTokenAmount light up as soon as real data exists.

export default async function PurchaseReceiptPage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const { purchaseId } = await params;

  // Not loaded yet. Keep these null; never fill with sample values.
  const status = null as PurchaseStatus | null;
  const amount = null as TokenBaseUnits | null;
  const promotionName = null as string | null;
  const purchasedAt = null as string | null;
  const txSignature = null as string | null;

  const unavailable = <span className="text-stone-400">Unavailable</span>;

  const details: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: "Purchase reference",
      value: (
        <>
          <span className="break-all font-mono">{purchaseId}</span>
          <span className="mt-0.5 block text-xs font-normal text-stone-500">
            From the link, not verified
          </span>
        </>
      ),
    },
    { label: "Promotion name", value: promotionName ?? unavailable },
    {
      label: "Purchase amount (mock USDC)",
      value: amount ? formatTokenAmount(amount) : unavailable,
    },
    { label: "Purchase date", value: purchasedAt ?? unavailable },
    {
      label: "Solana transaction signature",
      value: txSignature ? <span className="break-all font-mono">{txSignature}</span> : unavailable,
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
            Purchase Receipt
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
            A record of your purchase on Solana Devnet. Amounts are valueless test tokens, and the
            merchant&apos;s hedge is <strong>simulated</strong>.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-medium text-violet-800 underline-offset-4 hover:underline"
          >
            ← Back to homepage
          </Link>
        </header>

        {/* Purchase details */}
        <section
          aria-labelledby="details-heading"
          className="mt-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="details-heading" className="text-lg font-semibold text-stone-900">
              Purchase Details
            </h2>
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
              Data not connected
            </span>
          </div>
          <dl className="mt-4 divide-y divide-stone-100">
            {details.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <dt className="shrink-0 text-sm font-medium text-stone-600">{item.label}</dt>
                <dd className="min-w-0 text-sm font-medium text-stone-900 sm:text-right">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Status */}
        <section
          aria-labelledby="status-heading"
          className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="status-heading" className="text-lg font-semibold text-stone-900">
            Purchase Status
          </h2>
          <div className="mt-3">
            {status ? (
              <StatusBadge status={status} />
            ) : (
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300">
                Status unavailable
              </span>
            )}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            The current status will appear here once purchase data is connected. It will reflect
            confirmed on-chain state, not a guess.
          </p>
        </section>

        {/* Refund eligibility */}
        <section
          aria-labelledby="eligibility-heading"
          className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="eligibility-heading" className="text-lg font-semibold text-stone-900">
              Refund Eligibility
            </h2>
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
              Not yet verified
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            A refund is available only when the verified market outcome satisfies the
            promotion&apos;s refund condition and the on-chain purchase is eligible. Eligibility has
            not been verified, and no funds have been returned.
          </p>
        </section>

        {/* Claim */}
        <section
          aria-labelledby="claim-heading"
          className="mt-6 rounded-xl border border-dashed border-violet-300 bg-white p-5 sm:p-6"
        >
          <h2 id="claim-heading" className="text-lg font-semibold text-stone-900">
            Claim Refund
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">
            Eligible customers will claim their mock USDC refund through a Solana wallet.
          </p>
          <button
            type="button"
            disabled
            className="mt-4 cursor-not-allowed rounded-lg bg-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-500"
          >
            Claim Refund
          </button>
          <p className="mt-2 text-xs text-stone-500">
            Claims are not connected yet, so this button is disabled.
          </p>
        </section>
      </main>
    </div>
  );
}
