import Link from "next/link";
import type { PurchaseStatus, TokenBaseUnits } from "@hedged/shared";
import { DevnetBanner } from "@/components/devnet-banner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Presentational receipt shell. No purchase API or on-chain read is connected yet.
// Only the exact id "demo" shows the labeled DEMO_PURCHASE fixture; every other id keeps showing
// "Unavailable". Nothing here is a real purchase or payment, and no claim can be executed.
// TODO(Dev 1): load the purchase via REST (GET /api/purchases/:id) once Dev 4 documents the DTOs,
// and read on-chain state through @hedged/solana (Dev 3).

// Educational only. The related statuses are existing PurchaseStatus labels; no stage is "done".
const TRACKING_STAGES = [
  {
    title: "Customer deposits mock USDC into escrow",
    related: "Deposited",
  },
  {
    title: "The backend verifies the deposit and simulates a Gemini hedge",
    related: "Hedge simulated, then Hedged once confirmed on-chain",
  },
  {
    title: "The Gemini market reaches an officially finalized outcome",
    related: "Resolved",
  },
  {
    title: "An eligible customer or merchant claims the escrowed mock USDC",
    related: "Claimed",
  },
];

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

  const unavailable = <span className="text-stone-400">Unavailable</span>;
  const demoBadge = (
    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-orange-800 ring-1 ring-inset ring-orange-300">
      Demo data
    </span>
  );

  const details: { label: string; value: React.ReactNode }[] = [
    {
      label: "Purchase reference",
      value: (
        <>
          <span className="break-all font-mono">{purchaseId}</span>
          <span className="mt-0.5 block text-xs font-normal text-stone-500">
            {demo ? "Fictional reference" : "From the link, not verified"}
          </span>
        </>
      ),
    },
    { label: "Promotion name", value: promotionName ?? unavailable },
    {
      label: "Purchase amount (mock USDC)",
      value: amount ? formatTokenAmount(amount) : unavailable,
    },
    {
      label: "Purchase date",
      value: demo ? "Not applicable — no purchase occurred" : unavailable,
    },
    {
      label: "Solana transaction signature",
      value: demo ? "Not available — no transaction occurred" : unavailable,
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

        {demo && (
          <div
            role="note"
            className="mt-8 rounded-xl border-2 border-orange-300 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900 sm:p-5"
          >
            <p className="font-bold uppercase tracking-wide">
              Demo data: this is not a real receipt
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>This purchase is fictional, shown only to demonstrate the receipt layout.</li>
              <li>No mock USDC deposit happened, and no wallet or transaction exists.</li>
              <li>No Gemini hedge was executed and no real order was placed.</li>
              <li>No refund or merchant claim can be executed for this record.</li>
            </ul>
          </div>
        )}

        {/* Purchase details */}
        <section
          aria-labelledby="details-heading"
          className="mt-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="details-heading" className="text-lg font-semibold text-stone-900">
              Purchase Details
            </h2>
            {demo ? (
              demoBadge
            ) : (
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                Data not connected
              </span>
            )}
          </div>

          {demo && amount && (
            <div className="mt-4 rounded-lg bg-violet-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-violet-800">
                Purchase amount
              </p>
              <p className="mt-1 text-3xl font-semibold text-violet-900">
                {formatTokenAmount(amount)}
              </p>
              <p className="text-xs text-stone-600">mock USDC (Devnet test tokens), not paid</p>
            </div>
          )}

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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {status ? (
              <StatusBadge status={status} />
            ) : (
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300">
                Status unavailable
              </span>
            )}
            {demo && (
              <span className="text-xs font-semibold text-orange-800">
                Illustrative status — not confirmed
              </span>
            )}
          </div>
          {demo ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-stone-600">
              <li>
                &ldquo;Hedge simulated&rdquo; is a hypothetical UI scenario, not confirmed
                blockchain or backend state.
              </li>
              <li>No mock USDC was deposited.</li>
              <li>No Gemini trading or hedge execution happened.</li>
              <li>This purchase is not paid, confirmed or hedged.</li>
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-stone-600">
              The current status will appear here once purchase data is connected. It will reflect
              confirmed on-chain state, not a guess.
            </p>
          )}
        </section>

        {/* How tracking works */}
        <section
          aria-labelledby="tracking-heading"
          className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="tracking-heading" className="text-lg font-semibold text-stone-900">
            How Purchase Tracking Works
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            General explanation only. No stage is complete for this record.
          </p>
          <ol className="mt-4 space-y-3">
            {TRACKING_STAGES.map((stage, i) => (
              <li key={stage.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-stone-900">{stage.title}</p>
                  <p className="text-xs text-stone-500">Related status: {stage.related}</p>
                </div>
              </li>
            ))}
          </ol>
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
              {demo ? "Not verified" : "Not yet verified"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            A refund is available only when the verified market outcome satisfies the
            promotion&apos;s refund condition and the on-chain purchase is eligible.{" "}
            {demo
              ? "This demo record has no on-chain purchase, no official market outcome and no verified refund eligibility. Eligibility is not inferred from its illustrative status, and no funds are available to withdraw."
              : "Eligibility has not been verified, and no funds have been returned."}
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
            {demo
              ? "Fictional purchases cannot execute refund transactions, so this button is disabled."
              : "Claims are not connected yet, so this button is disabled."}
          </p>
        </section>
      </main>
    </div>
  );
}
