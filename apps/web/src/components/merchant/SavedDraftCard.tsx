"use client";

import { useMemo, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";

// Shows the demo draft saved by the Create Promotion page. READ-ONLY: this component never writes
// to sessionStorage. The draft is frontend-only: not published, not on-chain, not in a backend.
//
// The key and shape below MIRROR `DRAFT_STORAGE_KEY` / `DemoPromotionDraft` in
// app/merchant/new/page.tsx. They are repeated here because a Next.js page file cannot export
// extra values. If the form's draft changes, update this file too (the check below will simply
// show nothing for a draft it does not recognize).
const DRAFT_STORAGE_KEY = "wincentive:demo:promotion-draft";

interface SavedDraft {
  isDemoDraft: true;
  draftId: string;
  savedAt: string;
  name: string;
  description: string;
  offerAmount: string;
  geminiMarketId: string;
  geminiMarketIdStatus: "UNVERIFIED";
  refundTrigger: string;
  refundTriggerStatus: "UNVERIFIED";
  maxHedgePriceMicroUsd: string;
  hedgeBudget: string;
  expiresAt: string;
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isUnits = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

/** Parses stored JSON and checks every field. Returns null for anything missing or malformed. */
function parseDraft(raw: string | null): SavedDraft | null {
  if (!raw) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (typeof d !== "object" || d === null) return null;
    const r = d as Record<string, unknown>;
    if (
      r.isDemoDraft !== true ||
      !isText(r.draftId) ||
      !isText(r.savedAt) ||
      !isText(r.name) ||
      !isText(r.description) ||
      !isUnits(r.offerAmount) ||
      !isText(r.geminiMarketId) ||
      r.geminiMarketIdStatus !== "UNVERIFIED" ||
      !isText(r.refundTrigger) ||
      r.refundTriggerStatus !== "UNVERIFIED" ||
      !isUnits(r.maxHedgePriceMicroUsd) ||
      !isUnits(r.hedgeBudget) ||
      !isText(r.expiresAt) ||
      Number.isNaN(new Date(r.expiresAt).getTime())
    ) {
      return null;
    }
    return r as unknown as SavedDraft;
  } catch {
    return null; // corrupted JSON
  }
}

// sessionStorage can throw (blocked / private mode), so every access is wrapped.
function readRaw(): string | null {
  try {
    return sessionStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}
// The draft is only written by another page, so there is nothing to subscribe to here.
const subscribe = () => () => {};
// On the server (and during hydration) there is no browser storage, so nothing is shown.
const readServerRaw = () => null;

/** Whole-cent prices reuse formatTokenAmount; sub-cent prices are shown exactly, never as $0.00. */
function formatPrice(baseUnits: string): string {
  if (BigInt(baseUnits) % 10_000n === 0n) return formatTokenAmount(baseUnits);
  const digits = baseUnits.padStart(7, "0");
  return `$${digits.slice(0, -6)}.${digits.slice(-6).replace(/0+$/, "")}`;
}

// Styling only: the display face is provided by the page that renders this card (--font-display).
const DISPLAY = "font-[family-name:var(--font-display)]";

export function SavedDraftCard() {
  const raw = useSyncExternalStore(subscribe, readRaw, readServerRaw);
  const draft = useMemo(() => parseDraft(raw), [raw]);

  if (!draft) return null;

  const expires = new Date(draft.expiresAt).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <article
      aria-label="Saved demo draft"
      className="border-b border-l-[3px] border-b-[#E6E1D8] border-l-[#6133A7] py-8 pl-5 sm:pl-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-xl">
          <span className="inline-block rounded-full bg-[#6133A7] px-3 py-1 text-xs font-bold text-white">
            Demo draft
          </span>
          <h3
            className={`${DISPLAY} mt-3 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-[#211D28]`}
          >
            {draft.name}
          </h3>
          <p className="mt-1 text-sm text-[#5A5463]">Your saved draft</p>
          <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed text-[#4E4858]">
            {draft.description}
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p
            className={`${DISPLAY} text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums text-[#211D28]`}
          >
            {formatPrice(draft.offerAmount)}
          </p>
          <p className="mt-1.5 text-xs text-[#5A5463]">mock USDC</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Refund trigger</dt>
          <dd className="mt-1 break-words font-medium text-[#211D28]">{draft.refundTrigger}</dd>
          <dd className="mt-0.5 text-xs font-semibold text-[#7A4208]">Unverified label</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Expires</dt>
          <dd className="mt-1 font-medium text-[#211D28]">{expires} UTC</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Gemini market ID</dt>
          <dd className="mt-1 break-all font-mono text-[13px] text-[#211D28]">
            {draft.geminiMarketId}
          </dd>
          <dd className="mt-0.5 text-xs font-bold uppercase text-[#7A4208]">Unverified</dd>
        </div>
      </dl>

      <div className="mt-6 border-l-[3px] border-[#F58C38] pl-4 text-sm leading-relaxed text-[#4E4858]">
        <p className="font-semibold text-[#211D28]">This is a local draft, not a live promotion.</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>It exists only in this browser session.</li>
          <li>It has not been published on-chain or saved to the backend.</li>
          <li>It cannot accept deposits or checkout payments.</li>
          <li>Its Gemini market and refund condition have not been verified.</li>
        </ul>
      </div>
    </article>
  );
}
