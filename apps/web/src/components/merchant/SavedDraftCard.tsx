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
      className="mt-4 rounded-xl border-2 border-violet-300 bg-violet-50/60 p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-800">
            Your saved draft
          </p>
          <h3 className="mt-1 break-words text-lg font-semibold text-stone-900">{draft.name}</h3>
        </div>
        <span className="rounded-full bg-violet-700 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Demo draft
        </span>
      </div>

      <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-stone-700">
        {draft.description}
      </p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Purchase price
          </dt>
          <dd className="mt-1 text-lg font-semibold text-violet-900">
            {formatPrice(draft.offerAmount)}
          </dd>
          <dd className="text-xs text-stone-500">mock USDC</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Expires</dt>
          <dd className="mt-1 text-sm text-stone-800">{expires} UTC</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Refund trigger
          </dt>
          <dd className="mt-1 break-words text-sm text-stone-800">{draft.refundTrigger}</dd>
          <dd className="text-xs font-medium text-orange-700">Unverified label</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Gemini market ID
          </dt>
          <dd className="mt-1 break-all font-mono text-sm text-stone-800">
            {draft.geminiMarketId}
          </dd>
          <dd className="text-xs font-bold uppercase text-orange-700">Unverified</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900">
        <p className="font-medium">This is a local draft, not a live promotion.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>It exists only in this browser session.</li>
          <li>It has not been published on-chain or saved to the backend.</li>
          <li>It cannot accept deposits or checkout payments.</li>
          <li>Its Gemini market and refund condition have not been verified.</li>
        </ul>
      </div>
    </article>
  );
}
