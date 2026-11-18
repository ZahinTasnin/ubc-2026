"use client";

import localFont from "next/font/local";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { MOCK_USD_DECIMALS, type PriceMicroUsd, type TokenBaseUnits } from "@hedged/shared";
import { LogoMark } from "@/components/layout/LogoMark";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DevnetNetworkNotice } from "@/components/wallet/DevnetNetworkNotice";
import { formatTokenAmount } from "@/lib/format";

// Page-scoped styling, matching the homepage and the merchant dashboard: same vendored fonts
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
const BRAND_HAIRLINE = "bg-[linear-gradient(90deg,#6133A7,#B13BD8_38%,#F5539C_62%,#F58C38)]";

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

/** The Anchor program's MAX_MARKET_ID_LEN (programs/escrow/src/state/mod.rs). Rust `len()` counts UTF-8 bytes. */
const MAX_MARKET_ID_BYTES = 64;

/**
 * Market ID: required, and at most 64 UTF-8 BYTES (not characters) because the program stores it
 * on-chain. The trimmed value is measured, since that is what the draft saves. Existence of the
 * market is NOT checked here (that needs the backend).
 */
function marketIdError(value: string): string | undefined {
  const required = requiredText(value, "Gemini market ID");
  if (required) return required;
  const bytes = new TextEncoder().encode(value.trim()).length;
  return bytes > MAX_MARKET_ID_BYTES
    ? `Market ID must be ${MAX_MARKET_ID_BYTES} bytes or fewer (this one is ${bytes}).`
    : undefined;
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

/**
 * Largest token amount in base units: u64::MAX.
 * - Purchase price: the program stores it as `Promo.offer_amount: u64` (initialize_promo / deposit).
 * - Promotion budget: off-chain only (no on-chain field), but it is denominated in the same SPL
 *   token, whose amounts are u64 base units, so the same ceiling is used.
 */
const MAX_U64 = 18446744073709551615n;
const MAX_U64_DISPLAY = (() => {
  const digits = MAX_U64.toString();
  return `${digits.slice(0, -MOCK_USD_DECIMALS)}.${digits.slice(-MOCK_USD_DECIMALS)}`;
})();

/**
 * Amount > 0 with at most 6 decimals and at most u64::MAX base units (purchase price, budget).
 * The limit is checked with BigInt on the exact base-unit value. Too-large amounts are rejected,
 * never clamped.
 */
function positiveAmount(raw: string, label: string): string | undefined {
  const parsed = parseDecimal(raw, label);
  if ("error" in parsed) return parsed.error;
  // Greater than zero means at least one non-zero digit somewhere.
  if (!/[1-9]/.test(parsed.whole + parsed.frac)) return `${label} must be greater than 0.`;
  if (BigInt(decimalToBaseUnits(raw)) > MAX_U64) {
    return `${label} is too large. The maximum is ${MAX_U64_DISPLAY}.`;
  }
  return undefined;
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
    marketId: marketIdError(form.marketId),
    refundTrigger: requiredText(form.refundTrigger, "Refund trigger"),
    maxHedgePrice: hedgePrice(form.maxHedgePrice),
    budget: positiveAmount(form.budget, "Promotion budget"),
    expiresAt: futureDateTime(form.expiresAt),
  };
}

// 16px on mobile (no iOS focus-zoom), 14px from sm up. Placeholder text is >= 4.5:1 on white.
const INPUT_BASE =
  "mt-2 block w-full rounded-[10px] border bg-white px-3.5 py-2.5 text-base text-[#211D28] placeholder:text-[#6B6575] sm:text-sm focus:outline-none focus:ring-2";
const INPUT_OK = "border-[#CFC8BC] focus:border-[#6133A7] focus:ring-[#6133A7]/20";
const INPUT_INVALID = "border-[#C4372B] focus:border-[#C4372B] focus:ring-[#C4372B]/20";

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
      <label htmlFor={id} className="block text-sm font-semibold text-[#211D28]">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-semibold text-[#B3261E]">
          {error}
        </p>
      )}
      <p id={`${id}-help`} className="mt-1.5 text-xs leading-relaxed text-[#5A5463]">
        {help}
      </p>
    </div>
  );
}

/** One numbered step of the form: a ruled section with a large numeral, not a card. */
function Step({
  n,
  title,
  intro,
  children,
}: {
  n: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`step-${n}-heading`}
      className="border-t border-[#E6E1D8] py-9 first:border-t-2 first:border-[#211D28]"
    >
      <div className="flex items-baseline gap-4">
        <span
          aria-hidden
          className={`${DISPLAY} text-[2.6rem] font-light leading-none tracking-[-0.05em] tabular-nums text-[#6133A7]`}
        >
          {n}
        </span>
        <div>
          <h2
            id={`step-${n}-heading`}
            className={`${DISPLAY} text-[1.5rem] font-semibold leading-tight tracking-[-0.025em]`}
          >
            {title}
          </h2>
          <p className="mt-1 text-[15px] leading-relaxed text-[#5A5463]">{intro}</p>
        </div>
      </div>
      <div className="mt-7 grid gap-x-6 gap-y-6 sm:grid-cols-2">{children}</div>
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
      "marketId",
      "refundTrigger",
      "expiresAt",
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
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased`}
    >
      {/* Quiet disclosure strip (the full disclosure is in the footer) */}
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Devnet demo with valueless test tokens. Hedging is simulated.
      </p>

      {/* Shared header. Its wallet button sits OUTSIDE the <form>, so it can never submit the form. It is
          optional: drafts save without a wallet, and connecting does not publish anything or prove the
          wallet is on Devnet or authorized as a merchant. */}
      <SiteHeader current="promotions" />

      <main>
        {/* Intro: compact. Headline on the left, a small network utility on the right. */}
        <section className="mx-auto grid max-w-[1240px] gap-8 px-5 pb-10 pt-4 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-12 lg:pt-6">
          <div className="lg:col-span-7">
            <Link
              href="/merchant"
              className={`-my-3 inline-flex min-h-11 items-center text-sm font-medium text-[#6133A7] underline-offset-4 hover:underline ${FOCUS}`}
            >
              ← Back to Dashboard
            </Link>

            <p className="mt-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6133A7]">
              <span aria-hidden className="h-[3px] w-8 rounded-full bg-[#F58C38]" />
              Create a promotion
            </p>
            <h1
              className={`${DISPLAY} mt-5 text-[clamp(2.5rem,5vw,4.1rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              Give them something to root for.
            </h1>
            <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-[#5A5463]">
              Design an offer, choose its outcome, and see how customers will experience it.
            </p>
            <a
              href="#preview-heading"
              className={`mt-4 inline-block text-sm font-semibold text-[#6133A7] underline underline-offset-4 lg:hidden ${FOCUS}`}
            >
              Jump to the customer preview
            </a>
          </div>

          {/* Utility area. Read-only status: a verified Devnet RPC says nothing about the wallet's
              own network (the notice itself shows that as "Not verified"). Outside the <form>. */}
          <div className="lg:col-span-5 lg:self-end">
            <p className="text-sm font-semibold">Wallet and network</p>
            <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
              Wallet connection will be used for future on-chain promotion creation. It is optional,
              and connecting does not publish anything.
            </p>
            <DevnetNetworkNotice />
          </div>
        </section>

        <div className="mx-auto grid max-w-[1240px] gap-14 px-5 pb-20 sm:px-8 lg:grid-cols-12 lg:gap-12 lg:pb-28">
          {/* Configuration form */}
          <form className="lg:col-span-7" onSubmit={handleSubmit} noValidate>
            <Step n="01" title="The offer" intro="What you are selling and what customers pay.">
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
            </Step>

            <Step
              n="02"
              title="The outcome"
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
            </Step>

            <Step
              n="03"
              title="The limits"
              intro="When the offer ends, and off-chain guardrails for the simulated hedge. These are not escrowed funds."
            >
              <div className="sm:col-span-2">
                <Field
                  id="expiresAt"
                  error={errorFor("expiresAt")}
                  label="Promotion Expiration"
                  help="Deadline for purchase eligibility. Deposits are rejected after this time."
                >
                  <input {...inputProps("expiresAt")} type="datetime-local" />
                </Field>
              </div>
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
            </Step>

            {/* Primary action */}
            <div className="border-t border-[#E6E1D8] pt-9">
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#6133A7] px-9 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#4E2890] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]"
              >
                Save Demo Draft
              </button>
              <ul className="mt-5 max-w-xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[#5A5463]">
                <li>
                  Saved only in this browser session (sessionStorage), and shown on the dashboard
                  while this tab stays open.
                </li>
                <li>Saving does not publish a promotion. Publishing is not implemented yet.</li>
                <li>
                  No blockchain transaction is executed. No odds or cost estimates are shown because
                  no live market data is connected.
                </li>
              </ul>

              <div role="status" aria-live="polite">
                {save.status === "saved" && (
                  <div className="mt-5 max-w-xl border-l-[3px] border-[#1E8A5A] bg-[#EAF6F0] p-4 text-sm leading-relaxed text-[#14513A]">
                    <p className="font-semibold">Demo draft saved in this browser session.</p>
                    <p className="mt-1">
                      This promotion is <strong>not published</strong>,{" "}
                      <strong>not stored on-chain</strong>, and{" "}
                      <strong>not available for real checkout</strong>. The market ID and refund
                      trigger are unverified.
                    </p>
                    <p className="mt-1 break-all text-xs text-[#14513A]">
                      Draft ID: <span className="font-mono">{save.draftId}</span>
                    </p>
                    <p className="mt-2">
                      <Link
                        href="/merchant"
                        className={`font-semibold text-[#6133A7] underline underline-offset-4 ${FOCUS}`}
                      >
                        See it on the dashboard
                      </Link>
                    </p>
                  </div>
                )}
                {save.status === "error" && (
                  <p className="mt-5 max-w-xl border-l-[3px] border-[#C4372B] bg-[#FCEDEB] p-4 text-sm font-medium text-[#8A1F16]">
                    Could not save the demo draft: this browser blocked session storage. Nothing was
                    saved.
                  </p>
                )}
              </div>
            </div>
          </form>

          {/* Live customer preview: a ticket, sticky beside the form on large screens */}
          <aside
            aria-labelledby="preview-heading"
            className="lg:sticky lg:top-6 lg:col-span-5 lg:self-start"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2
                id="preview-heading"
                className={`${DISPLAY} scroll-mt-4 text-[1.5rem] font-semibold leading-tight tracking-[-0.025em]`}
              >
                Customer Preview
              </h2>
              <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                Demo draft preview
              </span>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">
              How your offer would look to customers. Updates as you type.
            </p>

            <article
              aria-label="Customer offer preview"
              className="relative mt-5 overflow-hidden rounded-[20px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-28px_rgba(33,29,40,0.32)]"
            >
              <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <LogoMark className="h-7 w-7 rounded-lg" />
                  <span className={`${DISPLAY} text-sm font-bold tracking-[-0.01em]`}>
                    Wincentive offer
                  </span>
                  <span
                    aria-hidden
                    className="ml-auto h-3.5 w-3.5 rounded-full border-2 border-[#CFC8BC]"
                  />
                </div>

                <h3
                  className={`${DISPLAY} mt-5 break-words text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em]`}
                >
                  {form.name.trim() || (
                    <span className="italic text-[#5A5463]">Your promotion name</span>
                  )}
                </h3>
                <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed text-[#4E4858]">
                  {form.description.trim() || (
                    <span className="italic text-[#5A5463]">
                      A description of the product or service will appear here.
                    </span>
                  )}
                </p>

                <div className="mt-5 flex items-end justify-between gap-4">
                  <p className="text-xs font-medium text-[#5A5463]">Purchase price</p>
                  <div className="text-right">
                    <p
                      className={`${DISPLAY} text-[2.4rem] font-semibold leading-none tracking-[-0.04em] tabular-nums`}
                    >
                      {previewPrice(form.price) ?? <span className="text-[#6B6575]">—</span>}
                    </p>
                    <p className="mt-1 text-xs text-[#5A5463]">mock USDC (Devnet test tokens)</p>
                  </div>
                </div>

                <div aria-hidden className="my-5 border-t border-dashed border-[#CFC8BC]" />

                <div>
                  <p className="text-xs font-medium text-[#5A5463]">Refund condition</p>
                  <p className="mt-1 break-words text-[15px] leading-relaxed text-[#211D28]">
                    If{" "}
                    {form.refundTrigger.trim() ? (
                      <strong className="font-semibold">{form.refundTrigger.trim()}</strong>
                    ) : (
                      <span className="italic text-[#5A5463]">your refund trigger happens</span>
                    )}
                    , you receive your purchase amount back.
                  </p>
                </div>
              </div>

              <p className="border-t border-[#E6E1D8] bg-[#FAF9F6] px-6 py-4 text-xs leading-relaxed text-[#5A5463]">
                This promotion has not been created or published. Real purchases would use valueless
                Devnet test tokens, and the merchant&apos;s Gemini hedge is simulated. The refund
                condition is the merchant&apos;s own label, not a verified market outcome.
              </p>
            </article>
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
