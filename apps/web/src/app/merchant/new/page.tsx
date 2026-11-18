"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DevnetBanner } from "@/components/devnet-banner";
import { MOCK_USD_DECIMALS, type PriceMicroUsd, type TokenBaseUnits } from "@hedged/shared";
import { formatTokenAmount } from "@/lib/format";

// Draft configuration UI only. Form values live in React state. "Save Demo Draft" validates every
// field and stores a frontend-only record in this browser tab's sessionStorage. Nothing is sent to
// an API, the blockchain, or a database, and the draft is NOT a published or on-chain promotion.
// All inputs are plain strings; validation and unit conversion work on the strings with BigInt
// (no floating-point math on money).
// TODO(Dev 1): replace the sessionStorage save with the real create flow once the REST DTOs and
// the Solana SDK builders exist.

/** Namespaced sessionStorage key. Holds ONE draft (the latest save). Temporary demo storage. */
const DRAFT_STORAGE_KEY = "wincentive:demo:promotion-draft";

/** Frontend-only draft record. Not a backend request schema. */
interface DemoPromotionDraft {
  isDemoDraft: true;
  draftId: string;
  savedAt: string; // ISO timestamp
  name: string;
  description: string;
  /** Mock USDC base units (6 decimals). */
  offerAmount: TokenBaseUnits;
  /** Typed by the merchant. Never checked against Gemini. */
  geminiMarketId: string;
  geminiMarketIdStatus: "UNVERIFIED";
  /** Merchant's own label for the refund outcome. Not a verified Gemini outcome. */
  refundTrigger: string;
  refundTriggerStatus: "UNVERIFIED";
  /** Micro-USD per $1-payout contract. */
  maxHedgePriceMicroUsd: PriceMicroUsd;
  /** Mock USDC base units. */
  hedgeBudget: TokenBaseUnits;
  /** ISO 8601 UTC, converted from the browser-local datetime-local value. */
  expiresAt: string;
}

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
  const baseUnits = BigInt(decimalToBaseUnits(raw));
  const centInBaseUnits = 10n ** BigInt(MOCK_USD_DECIMALS - 2);
  if (baseUnits % centInBaseUnits === 0n) return formatTokenAmount(baseUnits.toString());
  const digits = baseUnits.toString().padStart(MOCK_USD_DECIMALS + 1, "0");
  const exactFrac = digits.slice(-MOCK_USD_DECIMALS).replace(/0+$/, "");
  return `$${digits.slice(0, -MOCK_USD_DECIMALS)}.${exactFrac}`;
}

/**
 * Converts an already-validated decimal string (up to 6 decimals) to integer base units, e.g.
 * "5.25" -> "5250000". String padding + BigInt only, so there is no floating-point rounding.
 * The same 6-decimal scale serves mock USDC base units and micro-USD prices.
 */
function decimalToBaseUnits(raw: string): string {
  const [whole = "", frac = ""] = raw.trim().split(".");
  return BigInt(whole + frac.padEnd(MOCK_USD_DECIMALS, "0")).toString();
}

function newDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  // Result of the last "Save Demo Draft" click. Reset to idle as soon as the form is edited.
  const [save, setSave] = useState<
    { status: "idle" } | { status: "saved"; draftId: string } | { status: "error" }
  >({ status: "idle" });

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
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [key]: e.target.value }));
        setSave({ status: "idle" }); // editing clears any "saved" message
      },
      onBlur: () => setTouched((prev) => ({ ...prev, [key]: true })),
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${key}-error ${key}-help` : `${key}-help`,
    };
  };

  // Runs for the Save button AND the Enter key (both submit the form).
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Show every field's error, including fields the user never touched.
    setTouched({
      name: true,
      description: true,
      price: true,
      marketId: true,
      refundTrigger: true,
      maxHedgePrice: true,
      budget: true,
      expiresAt: true,
    });

    // Invalid data is never saved. Move focus to the first invalid field (in on-screen order).
    const screenOrder: FieldKey[] = [
      "name",
      "description",
      "price",
      "expiresAt",
      "marketId",
      "refundTrigger",
      "maxHedgePrice",
      "budget",
    ];
    const firstInvalid = screenOrder.find((key) => allErrors[key]);
    if (firstInvalid) {
      setSave({ status: "idle" });
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    const draft: DemoPromotionDraft = {
      isDemoDraft: true,
      draftId: newDraftId(),
      savedAt: new Date().toISOString(),
      name: form.name.trim(),
      description: form.description.trim(),
      offerAmount: decimalToBaseUnits(form.price),
      geminiMarketId: form.marketId.trim(),
      geminiMarketIdStatus: "UNVERIFIED",
      refundTrigger: form.refundTrigger.trim(),
      refundTriggerStatus: "UNVERIFIED",
      maxHedgePriceMicroUsd: decimalToBaseUnits(form.maxHedgePrice),
      hedgeBudget: decimalToBaseUnits(form.budget),
      expiresAt: new Date(form.expiresAt).toISOString(),
    };

    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      setSave({ status: "saved", draftId: draft.draftId });
    } catch {
      // Storage can be blocked or full (e.g. private mode). Do not claim it was saved.
      setSave({ status: "error" });
    }
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
            Draft configuration · not published
          </p>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
            Configure an outcome-based refund offer for any product or service. Hedging against the
            Gemini prediction market is <strong>simulated</strong>: no real orders are placed and no
            real money moves.
          </p>
        </header>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
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

          <div className="rounded-xl border border-dashed border-violet-300 bg-white px-5 py-5">
            <p className="text-sm text-stone-600">
              Saving stores a demo draft in this browser session only. Publishing promotions is not
              implemented yet. No odds or cost estimates are shown because no live market data is
              connected.
            </p>
            <button
              type="submit"
              className="mt-4 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              Save Demo Draft
            </button>

            <div role="status" aria-live="polite">
              {save.status === "saved" && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
                  <p className="font-medium">Demo draft saved in this browser session.</p>
                  <p className="mt-1">
                    This promotion is <strong>not published</strong>,{" "}
                    <strong>not stored on-chain</strong>, and{" "}
                    <strong>not available for real checkout</strong>. The market ID and refund
                    trigger are unverified.
                  </p>
                  <p className="mt-1 break-all text-xs text-emerald-800">
                    Draft ID: <span className="font-mono">{save.draftId}</span>
                  </p>
                </div>
              )}
              {save.status === "error" && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  Could not save the demo draft: this browser blocked session storage. Nothing was
                  saved.
                </p>
              )}
            </div>
          </div>
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
