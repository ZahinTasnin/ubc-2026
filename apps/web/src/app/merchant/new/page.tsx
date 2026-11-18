"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DevnetBanner } from "@/components/devnet-banner";
import { formatTokenAmount } from "@/lib/format";

// Draft configuration UI only. Values live in local React state: nothing is sent to an API, the
// blockchain, or a database. All inputs are plain strings exactly as typed by the merchant.
// Validation below checks the typed strings directly (no floating-point math on money).
// TODO(Dev 1): convert to base units / micro-USD and submit once the REST DTOs exist.

const MOCK_USD_DECIMALS = 6; // mock USDC precision (same as MOCK_USD_DECIMALS in @hedged/shared)

type FormValues = {
  name: string;
  description: string;
  price: string;
  marketId: string;
  refundTrigger: string;
  maxHedgePrice: string;
  budget: string;
  expiresAt: string;
};
type FieldKey = keyof FormValues;
type FormErrors = Partial<Record<FieldKey, string>>;

// Digits with an optional decimal part: "5", "5.25", ".5". No signs, commas or exponents ("1e3").
const DECIMAL_RE = /^(\d+(\.\d*)?|\.\d+)$/;

/** Returns an error message for a text field that is empty or only whitespace. */
function requiredText(value: string, label: string): string | undefined {
  return value.trim() === "" ? `${label} is required.` : undefined;
}

/**
 * Checks a decimal string. Returns an error message, or the parsed parts when valid.
 * Works on the string itself so no money is ever rounded by floating-point math.
 */
function parseDecimal(
  raw: string,
  label: string,
): { error: string } | { whole: string; frac: string } {
  const value = raw.trim();
  if (value === "") return { error: `${label} is required.` };
  if (!DECIMAL_RE.test(value)) return { error: `Enter a valid number, like 5 or 5.25.` };
  const [whole = "", frac = ""] = value.split(".");
  if (frac.length > MOCK_USD_DECIMALS) {
    return { error: `Use at most ${MOCK_USD_DECIMALS} decimal places.` };
  }
  return { whole: whole.replace(/^0+/, ""), frac };
}

/** Amount > 0 with at most 6 decimals (purchase price, budget). */
function positiveAmount(raw: string, label: string): string | undefined {
  const parsed = parseDecimal(raw, label);
  if ("error" in parsed) return parsed.error;
  // Greater than zero means at least one non-zero digit somewhere.
  return /[1-9]/.test(parsed.whole + parsed.frac) ? undefined : `${label} must be greater than 0.`;
}

/**
 * Text for the customer preview price, or null if the typed price is not a valid amount.
 * Converts the decimal string to 6-decimal base units with string operations + BigInt (no floats).
 * Whole-cent amounts reuse formatTokenAmount; sub-cent amounts are shown exactly so a valid price
 * like 0.000001 is never rounded to "$0.00".
 */
function previewPrice(raw: string): string | null {
  if (positiveAmount(raw, "Purchase price")) return null; // empty or invalid
  const [whole = "", frac = ""] = raw.trim().split(".");
  const baseUnits = BigInt(whole + frac.padEnd(MOCK_USD_DECIMALS, "0"));
  const centInBaseUnits = 10n ** BigInt(MOCK_USD_DECIMALS - 2);
  if (baseUnits % centInBaseUnits === 0n) return formatTokenAmount(baseUnits.toString());
  const digits = baseUnits.toString().padStart(MOCK_USD_DECIMALS + 1, "0");
  const exactFrac = digits.slice(-MOCK_USD_DECIMALS).replace(/0+$/, "");
  return `$${digits.slice(0, -MOCK_USD_DECIMALS)}.${exactFrac}`;
}

/** Price per $1 of payout: greater than 0 and at most 1 (so exactly "1", "1.0", ... is the top). */
function hedgePrice(raw: string): string | undefined {
  const parsed = parseDecimal(raw, "Maximum hedge price");
  if ("error" in parsed) return parsed.error;
  const { whole, frac } = parsed;
  const isZero = whole === "" && !/[1-9]/.test(frac);
  const isAboveOne =
    whole.length > 1 || (whole === "1" && /[1-9]/.test(frac)) || (whole !== "" && whole !== "1");
  if (isZero) return "Maximum hedge price must be greater than 0.";
  if (isAboveOne) return "Maximum hedge price cannot be more than 1 ($1 payout).";
  return undefined;
}

/** datetime-local gives "YYYY-MM-DDTHH:mm" in the browser's local time; Date parses it as local. */
function futureDateTime(value: string): string | undefined {
  if (value === "") return "Promotion expiration is required.";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Enter a valid date and time.";
  return time > Date.now() ? undefined : "Expiration must be in the future (your local time).";
}

function validate(form: FormValues): FormErrors {
  return {
    name: requiredText(form.name, "Promotion name"),
    description: requiredText(form.description, "Description"),
    price: positiveAmount(form.price, "Purchase price"),
    marketId: requiredText(form.marketId, "Gemini market ID"),
    refundTrigger: requiredText(form.refundTrigger, "Refund trigger"),
    maxHedgePrice: hedgePrice(form.maxHedgePrice),
    budget: positiveAmount(form.budget, "Promotion budget"),
    expiresAt: futureDateTime(form.expiresAt),
  };
}

const INPUT_BASE =
  "mt-2 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2";
const INPUT_OK = "border-stone-300 focus:border-violet-500 focus:ring-violet-200";
const INPUT_INVALID = "border-red-400 focus:border-red-500 focus:ring-red-100";

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-900">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      <p id={`${id}-help`} className="mt-1.5 text-xs leading-relaxed text-stone-500">
        {help}
      </p>
    </div>
  );
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      <p className="mt-1 text-sm text-stone-600">{intro}</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function NewPromotionPage() {
  const [form, setForm] = useState<FormValues>({
    name: "",
    description: "",
    price: "",
    marketId: "",
    refundTrigger: "",
    maxHedgePrice: "",
    budget: "",
    expiresAt: "",
  });
  // A field is "touched" once the user has left it (blur). Errors only show for touched fields.
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});

  // Errors are recomputed from the current values on every render, so they update and disappear
  // as soon as the user corrects a field.
  const allErrors = validate(form);
  const errorFor = (key: FieldKey) => (touched[key] ? allErrors[key] : undefined);

  // Props shared by every input: value, handlers, and accessibility attributes.
  const inputProps = (key: FieldKey) => {
    const error = errorFor(key);
    return {
      id: key,
      value: form[key],
      className: `${INPUT_BASE} ${error ? INPUT_INVALID : INPUT_OK}`,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
      onBlur: () => setTouched((prev) => ({ ...prev, [key]: true })),
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${key}-error ${key}-help` : `${key}-help`,
    };
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <DevnetBanner />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/merchant"
          className="text-sm font-medium text-violet-800 underline-offset-4 hover:underline"
        >
          ← Back to Dashboard
        </Link>

        <header className="mt-5 border-b border-stone-200 pb-8">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
            <span className="tracking-tight text-violet-900">Wincentive</span>
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Create Promotion
          </h1>
          <p className="mt-3 inline-block rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800">
            Draft configuration · nothing is saved or submitted
          </p>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
            Configure an outcome-based refund offer for any product or service. Hedging against the
            Gemini prediction market is <strong>simulated</strong>: no real orders are placed and no
            real money moves.
          </p>
        </header>

        <form className="mt-8 space-y-6" onSubmit={(e) => e.preventDefault()}>
          <Section title="Offer" intro="What you are selling and what customers pay.">
            <div className="sm:col-span-2">
              <Field
                id="name"
                error={errorFor("name")}
                label="Promotion Name"
                help="Shown to you and your customers."
              >
                <input {...inputProps("name")} type="text" placeholder="Game Day Refund" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field
                id="description"
                error={errorFor("description")}
                label="Product or Service Description"
                help="Describe what the customer is buying. Any product or service works."
              >
                <textarea
                  {...inputProps("description")}
                  rows={3}
                  placeholder="What does the customer receive?"
                />
              </Field>
            </div>
            <Field
              id="price"
              error={errorFor("price")}
              label="Purchase Price (mock USDC)"
              help="Amount each customer deposits into escrow, and the amount refunded if the trigger occurs. Valueless Devnet test tokens."
            >
              <input
                {...inputProps("price")}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0.00"
              />
            </Field>
            <Field
              id="expiresAt"
              error={errorFor("expiresAt")}
              label="Promotion Expiration"
              help="Deadline for purchase eligibility. Deposits are rejected after this time."
            >
              <input {...inputProps("expiresAt")} type="datetime-local" />
            </Field>
          </Section>

          <Section
            title="Prediction market"
            intro="The Gemini market that decides whether customers are refunded."
          >
            <Field
              id="marketId"
              error={errorFor("marketId")}
              label="Gemini Market ID"
              help="Paste the exact market identifier. Market search is not connected yet, and the ID is not validated."
            >
              <input {...inputProps("marketId")} type="text" placeholder="Market identifier" />
            </Field>
            <Field
              id="refundTrigger"
              error={errorFor("refundTrigger")}
              label="Refund Trigger"
              help="A readable label for the outcome that earns customers a refund. Customers are refunded if the market resolves YES."
            >
              <input
                {...inputProps("refundTrigger")}
                type="text"
                placeholder="Outcome that triggers a refund"
              />
            </Field>
          </Section>

          <Section
            title="Simulated hedge limits"
            intro="Off-chain guardrails for the simulated hedge. These are not escrowed funds."
          >
            <Field
              id="maxHedgePrice"
              error={errorFor("maxHedgePrice")}
              label="Maximum Hedge Price (USD per $1 payout)"
              help="The most you would accept paying per $1 of simulated payout. If the modeled price is above this, the hedge is treated as failed and the customer is refunded."
            >
              <input
                {...inputProps("maxHedgePrice")}
                type="number"
                inputMode="decimal"
                min="0"
                max="1"
                step="any"
                placeholder="0.00"
              />
            </Field>
            <Field
              id="budget"
              error={errorFor("budget")}
              label="Promotion Budget (mock USDC)"
              help="Your cap on total modeled hedge spending across all purchases. Separate from customer deposits held in Solana escrow."
            >
              <input
                {...inputProps("budget")}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0.00"
              />
            </Field>
          </Section>

          <p className="rounded-xl border border-dashed border-violet-300 bg-white px-5 py-4 text-sm text-stone-600">
            Submitting promotions is not implemented yet, so there is no Create button. No odds or
            cost estimates are shown because no live market data is connected.
          </p>
        </form>

        <section aria-labelledby="preview-heading" className="mt-10">
          <h2 id="preview-heading" className="text-lg font-semibold text-stone-900">
            Customer Preview
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            How your offer would look to customers. Updates as you type.
          </p>

          <article className="mt-4 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 bg-violet-50 px-5 py-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-violet-900">
                <span aria-hidden className="h-2 w-2 rounded-sm bg-orange-500" />
                Wincentive
              </span>
              <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                Draft Preview
              </span>
            </div>

            <div className="px-5 py-6 sm:px-6">
              <h3 className="break-words text-2xl font-semibold tracking-tight text-stone-900">
                {form.name.trim() || <span className="text-stone-400">Your promotion name</span>}
              </h3>
              <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-stone-600">
                {form.description.trim() || (
                  <span className="text-stone-400">
                    A description of the product or service will appear here.
                  </span>
                )}
              </p>

              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-stone-50 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Purchase price
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold text-violet-900">
                    {previewPrice(form.price) ?? <span className="text-stone-300">—</span>}
                  </dd>
                  <dd className="mt-1 text-xs text-stone-500">mock USDC (Devnet test tokens)</dd>
                </div>
                <div className="rounded-xl bg-stone-50 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Refund condition
                  </dt>
                  <dd className="mt-1 break-words text-sm leading-relaxed text-stone-800">
                    If{" "}
                    {form.refundTrigger.trim() ? (
                      <strong className="font-semibold">{form.refundTrigger.trim()}</strong>
                    ) : (
                      <span className="text-stone-400">your refund trigger happens</span>
                    )}
                    , you receive your purchase amount back.
                  </dd>
                </div>
              </dl>
            </div>

            <p className="border-t border-stone-100 bg-stone-50 px-5 py-3 text-xs leading-relaxed text-stone-500">
              This promotion has not been created or published. Real purchases would use valueless
              Devnet test tokens, and the merchant&apos;s Gemini hedge is simulated. The refund
              condition is the merchant&apos;s own label, not a verified market outcome.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
