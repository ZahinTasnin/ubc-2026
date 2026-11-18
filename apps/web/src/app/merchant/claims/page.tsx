import Link from "next/link";
import { DevnetBanner } from "@/components/devnet-banner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DEMO_PROMOTION } from "@/lib/fixtures/promotions";
import { DEMO_PURCHASE } from "@/lib/fixtures/purchases";
import { formatTokenAmount } from "@/lib/format";

// Presentational shell. No settlement API or on-chain read is connected yet. The single table row
// is the labeled DEMO_PURCHASE fixture: fictional, never counted in the overview, and never
// claimable. Nothing here is real data.
// TODO(Dev 1): load settlements via REST once Dev 4 documents the DTOs, and verify claim
// eligibility from on-chain purchase + promo state via @hedged/solana (Dev 3). Off-chain status
// alone (e.g. RESOLVED) must never decide whether a merchant can claim.

const OVERVIEW = [
  { label: "Awaiting resolution", hint: "Purchases whose market outcome is not final yet" },
  { label: "Potentially claimable", hint: "Must still be verified against on-chain state" },
  { label: "Completed claims", hint: "Merchant claims confirmed on-chain" },
];

const COLUMNS = [
  "Purchase reference",
  "Promotion",
  "Purchase amount",
  "Market outcome",
  "Purchase status",
  "Claim eligibility",
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
    <div className="min-h-screen bg-stone-50">
      <DevnetBanner />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <header className="border-b border-stone-200 pb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
            <span className="tracking-tight text-violet-900">Wincentive</span>
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Merchant Claims
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
            Review settled purchases and claim escrowed test tokens when the refund condition does
            not occur.
          </p>
          <Link
            href="/merchant"
            className="mt-4 inline-block text-sm font-medium text-violet-800 underline-offset-4 hover:underline"
          >
            ← Back to Merchant Dashboard
          </Link>
        </header>

        {/* Settlement overview */}
        <section aria-labelledby="overview-heading" className="mt-10">
          <h2
            id="overview-heading"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Settlement Overview
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {OVERVIEW.map((card) => (
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

        {/* Purchase settlements */}
        <section aria-labelledby="settlements-heading" className="mt-12">
          <h2 id="settlements-heading" className="text-xl font-semibold text-stone-900">
            Purchase Settlements
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Live settlement data is not connected yet. The only row below is a fictional example.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-orange-800 ring-1 ring-inset ring-orange-300">
              Demo data
            </span>
            <span className="text-xs text-stone-500">
              Fictional purchase. Not counted in the overview above.
            </span>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    {COLUMNS.map((name) => (
                      <th key={name} scope="col" className="px-4 py-3 font-medium">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-orange-200 bg-orange-50/60 align-top">
                    <td className="px-4 py-4">
                      <span className="font-mono text-stone-900">{DEMO_PURCHASE.id}</span>{" "}
                      <span className="text-stone-600">(fictional)</span>
                      <Link
                        href={`/purchases/${DEMO_PURCHASE.id}`}
                        className="mt-1 block text-xs font-medium text-violet-800 underline-offset-4 hover:underline"
                      >
                        View Demo Receipt
                      </Link>
                      <span className="block text-xs text-stone-500">
                        Illustrative receipt, not proof of payment
                      </span>
                    </td>
                    <td className="px-4 py-4 text-stone-900">{promotionName}</td>
                    <td className="px-4 py-4">
                      <span className="font-semibold text-stone-900">
                        {formatTokenAmount(DEMO_PURCHASE.amount)}
                      </span>
                      <span className="block text-xs text-stone-500">mock USDC, not paid</span>
                    </td>
                    <td className="px-4 py-4 text-stone-700">Not verified</td>
                    <td className="px-4 py-4">
                      <StatusBadge status={DEMO_PURCHASE.status} />
                      <span className="mt-1 block text-xs font-semibold text-orange-800">
                        Illustrative, not confirmed
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-medium text-stone-900">Not eligible — demo only</span>
                      <span className="block text-xs text-stone-500">
                        No deposit, no finalized outcome, claim unverified
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            role="note"
            className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900"
          >
            <p className="font-medium">About this demo row</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
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
        </section>

        {/* Merchant claim */}
        <section
          aria-labelledby="claim-heading"
          className="mt-12 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="claim-heading" className="text-xl font-semibold text-stone-900">
            Merchant Claim
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-stone-600">
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
              The simulated Gemini hedge ledger is separate from the real Solana escrow. No funds
              move between them.
            </li>
          </ul>
          <button
            type="button"
            disabled
            className="mt-5 cursor-not-allowed rounded-lg bg-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-500"
          >
            Claim Funds
          </button>
          <p className="mt-2 text-xs text-stone-500">
            Claims are not connected yet, so this button is disabled.
          </p>
        </section>
      </main>
    </div>
  );
}
