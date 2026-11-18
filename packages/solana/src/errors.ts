export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented yet: ${what}`);
    this.name = "NotImplementedError";
  }
}

/** Escrow program error codes (Anchor: 6000 + enum order, append-only). Source: the IDL. */
export const ESCROW_ERRORS = {
  Unauthorized: 6000,
  Paused: 6001,
  InvalidState: 6002,
  WrongMint: 6003,
  WrongTokenAccount: 6004,
  DepositClosed: 6005,
  WrongAmount: 6006,
  PromoNotActive: 6007,
  AlreadyResolved: 6008,
  AlreadyHedged: 6009,
  AlreadyCancelled: 6010,
  AlreadyClaimed: 6011,
  MarketIdTooLong: 6012,
  MathOverflow: 6013,
  InvalidOfferAmount: 6014,
  InvalidDeadline: 6015,
  EmptyMarketId: 6016,
  WrongDecimals: 6017,
  InvalidRelayer: 6018,
  InsufficientVaultFunds: 6019,
  ResolutionTooEarly: 6020,
  TimeoutNotElapsed: 6021,
  InvalidTimeout: 6022,
} as const;
export type EscrowErrorName = keyof typeof ESCROW_ERRORS;

/** Anchor framework errors we map explicitly. */
export const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;
export const ANCHOR_CONSTRAINT_SEEDS = 2006;

const BY_CODE = new Map<number, EscrowErrorName>(
  Object.entries(ESCROW_ERRORS).map(([k, v]) => [v, k as EscrowErrorName]),
);
export const escrowErrorName = (code: number): EscrowErrorName | undefined => BY_CODE.get(code);

/**
 * Pull the custom program error number out of anything web3.js / Anchor throws or returns:
 * `{ InstructionError: [i, { Custom: n }] }`, "custom program error: 0x177a", Anchor's
 * "Error Number: 6009" log line, or SendTransactionError logs. Returns null if none is found.
 */
export function extractProgramErrorCode(
  input: unknown,
  logs?: readonly string[] | null,
): number | null {
  const seen = new Set<unknown>();
  const visit = (v: unknown): number | null => {
    if (v == null || seen.has(v)) return null;
    if (typeof v === "string") return fromText(v);
    if (typeof v !== "object") return null;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.Custom === "number") return o.Custom;
    if (Array.isArray(o.InstructionError)) {
      const r = visit(o.InstructionError[1]);
      if (r != null) return r;
    }
    const code = o.code;
    if (typeof code === "number" && code >= 2000 && code < 7000) return code;
    const errCode = o.error as { errorCode?: { number?: number } } | undefined;
    if (typeof errCode?.errorCode?.number === "number") return errCode.errorCode.number;
    for (const key of ["err", "error", "value", "cause", "transactionLogs", "logs"]) {
      const r = visit(o[key]);
      if (r != null) return r;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = visit(item);
        if (r != null) return r;
      }
    }
    if (typeof o.message === "string") return fromText(o.message);
    return null;
  };
  const direct = visit(input);
  if (direct != null) return direct;
  for (const line of logs ?? []) {
    const r = fromText(line);
    if (r != null) return r;
  }
  return null;
}

function fromText(s: string): number | null {
  const anchor = /Error Number: (\d+)/.exec(s);
  if (anchor) return Number(anchor[1]);
  const hex = /custom program error: 0x([0-9a-fA-F]+)/.exec(s);
  if (hex) return parseInt(hex[1]!, 16);
  return null;
}
