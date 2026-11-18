// Purely presentational transaction status. It renders EXACTLY the state it is given.
//
// - No hooks, no wallet access, no RPC calls, no transaction submission, no timers and no
//   automatic progress. It never changes state by itself; only new props change what it shows.
// - It cannot start, sign, send or confirm anything.
//
// IMPORTANT for integrators: supply `confirmed` ONLY after the transaction has actually been
// confirmed on-chain (and, where the app depends on account state, that state has been re-read).
// Never show `confirmed` optimistically, for a fixture, or when the outcome is merely unknown.
// If a submission's outcome is unknown (e.g. a confirmation timeout), keep `confirming` or
// re-check; do not report `failed` or `confirmed` by guessing.
//
// How a future flow would drive it (the parent owns the state, e.g. useState in a client component):
//   idle -> wallet_required            (no wallet connected)
//   idle -> awaiting_signature         (just before asking the wallet to sign)
//   awaiting_signature -> submitted    (wallet returned a real signature: pass it in)
//   submitted -> confirming            (waiting for network confirmation)
//   confirming -> confirmed            (only after real on-chain confirmation)
//   any -> failed                      (rejected, errored, or confirmed as failed; pass a safe message)

/** Transaction lifecycle state, supplied by the caller. */
export type TransactionState =
  | { status: "idle" }
  | { status: "wallet_required" }
  | { status: "awaiting_signature" }
  /** `signature` must be a REAL signature returned by the network/wallet. Never invent one. */
  | { status: "submitted"; signature?: string }
  | { status: "confirming"; signature?: string }
  /** Only after actual on-chain confirmation (see the note above). */
  | { status: "confirmed"; signature?: string }
  /** `message` is shown to the user: pass a short, user-safe reason (no secrets, no raw dumps). */
  | { status: "failed"; message?: string };

type Tone = "stone" | "orange" | "violet" | "green" | "red";
type Indicator = "ring" | "bang" | "spinner" | "dot" | "check" | "cross";

const STATES: Record<
  TransactionState["status"],
  { title: string; body: string; tone: Tone; indicator: Indicator }
> = {
  idle: {
    title: "No transaction started",
    body: "Nothing has been sent to your wallet or to Solana.",
    tone: "stone",
    indicator: "ring",
  },
  wallet_required: {
    title: "Wallet connection needed",
    body: "Connect a Solana wallet to continue. Nothing has been sent.",
    tone: "orange",
    indicator: "bang",
  },
  awaiting_signature: {
    title: "Waiting for wallet approval",
    body: "Review and approve the request in your wallet. Nothing is sent until you approve.",
    tone: "violet",
    indicator: "spinner",
  },
  submitted: {
    title: "Transaction submitted",
    body: "Your transaction was sent to Solana. It is not confirmed yet.",
    tone: "violet",
    indicator: "dot",
  },
  confirming: {
    title: "Waiting for confirmation",
    body: "Waiting for the Solana network to confirm the transaction.",
    tone: "violet",
    indicator: "spinner",
  },
  confirmed: {
    title: "Transaction confirmed",
    body: "The transaction was confirmed on-chain.",
    tone: "green",
    indicator: "check",
  },
  failed: {
    title: "Transaction failed",
    body: "The transaction did not complete. Check your wallet and try again.",
    tone: "red",
    indicator: "cross",
  },
};

const TONES: Record<Tone, { box: string; indicator: string; title: string }> = {
  stone: {
    box: "border-stone-200 bg-stone-50",
    indicator: "border-stone-400 text-stone-500",
    title: "text-stone-900",
  },
  orange: {
    box: "border-orange-200 bg-orange-50",
    indicator: "border-orange-500 bg-orange-100 text-orange-800",
    title: "text-orange-900",
  },
  violet: {
    box: "border-violet-200 bg-violet-50",
    indicator: "border-violet-600 text-violet-700",
    title: "text-violet-900",
  },
  green: {
    box: "border-emerald-200 bg-emerald-50",
    indicator: "border-emerald-600 bg-emerald-100 text-emerald-800",
    title: "text-emerald-900",
  },
  red: {
    box: "border-red-200 bg-red-50",
    indicator: "border-red-600 bg-red-100 text-red-800",
    title: "text-red-900",
  },
};

// A Solana signature is 64 bytes, which is 86 to 88 base58 characters. Anything that does not
// look like one is NOT shown, so a made-up or malformed string can never appear as a signature.
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const MAX_MESSAGE_LENGTH = 200;

function shorten(signature: string): string {
  return `${signature.slice(0, 8)}…${signature.slice(-8)}`;
}

function IndicatorIcon({ kind, className }: { kind: Indicator; className: string }) {
  const base = `flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold leading-none ${className}`;
  if (kind === "spinner") {
    // Spins only while waiting; users who prefer reduced motion get a static ring.
    return (
      <span
        aria-hidden
        className={`h-6 w-6 shrink-0 rounded-full border-2 border-t-transparent animate-spin motion-reduce:animate-none ${className}`}
      />
    );
  }
  const glyph = { ring: "", bang: "!", dot: "", check: "✓", cross: "✕" }[kind];
  return (
    <span aria-hidden className={base}>
      {kind === "dot" ? <span className="h-2 w-2 rounded-full bg-current" /> : glyph}
    </span>
  );
}

export function TransactionStatus({
  state,
  className = "",
}: {
  state: TransactionState;
  className?: string;
}) {
  const config = STATES[state.status];
  const tone = TONES[config.tone];

  const rawSignature = "signature" in state ? state.signature : undefined;
  const signature = rawSignature && SIGNATURE_RE.test(rawSignature) ? rawSignature : undefined;

  const failureMessage =
    state.status === "failed" ? state.message?.trim().slice(0, MAX_MESSAGE_LENGTH) : undefined;

  return (
    <div
      // Failures are announced assertively; everything else politely.
      role={state.status === "failed" ? "alert" : "status"}
      aria-live={state.status === "failed" ? "assertive" : "polite"}
      className={`flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${tone.box} ${className}`}
    >
      <IndicatorIcon kind={config.indicator} className={tone.indicator} />
      <div className="min-w-0 text-sm">
        <p className={`font-semibold ${tone.title}`}>{config.title}</p>
        <p className="mt-0.5 leading-relaxed text-stone-700">{config.body}</p>

        {failureMessage && (
          <p className="mt-1.5 break-words leading-relaxed text-red-900">
            <span className="font-medium">Reason:</span> {failureMessage}
          </p>
        )}

        {signature && (
          <p className="mt-1.5 text-xs text-stone-600">
            <span className="font-medium">Transaction signature:</span>{" "}
            {/* Short form for sighted users (full value on hover); full value for screen readers. */}
            <span aria-hidden title={signature} className="font-mono">
              {shorten(signature)}
            </span>
            <span className="sr-only">{signature}</span>
          </p>
        )}
      </div>
    </div>
  );
}
