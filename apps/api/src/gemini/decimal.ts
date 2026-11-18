/**
 * Exact decimal-string conversions for Gemini values. Gemini returns prices and quantities as
 * decimal strings ("0.93", "1040.0"); we never parse them as floats.
 *
 * Units used across the API:
 * - price: micro-USD per $1-payout contract (bigint), $0.93 = 930_000n
 * - quantity: hundredths of a contract (bigint). Gemini's quantityIncrement is 0.01, so a
 *   hundredth is the smallest tradeable size. 5 contracts = 500n, 4.5 contracts = 450n.
 * - money: mock-token base units (6 decimals), which are numerically equal to micro-USD.
 */

const PRICE_RE = /^\d+(\.\d{1,6})?$/;
const QTY_RE = /^\d+(\.\d+)?$/;

/** Base units (= micro-USD) paid out by one hundredth of a $1 contract. */
export const BASE_UNITS_PER_HUNDREDTH = 10_000n;

/** "0.93" -> 930000n. Throws on anything that is not a plain non-negative decimal. */
export function usdToMicro(value: string): bigint {
  if (!PRICE_RE.test(value)) throw new Error(`Invalid USD decimal from Gemini: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

/** Like usdToMicro but returns null for missing/empty values. */
export function usdToMicroOrNull(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  return usdToMicro(value);
}

/**
 * "1040.0" -> 104000n. Digits past the second decimal are dropped (floored), which can only
 * understate available depth, never overstate it.
 */
export function qtyToHundredths(value: string): bigint {
  if (!QTY_RE.test(value)) throw new Error(`Invalid quantity from Gemini: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
}

/** 500n -> "5", 450n -> "4.5", 1n -> "0.01". */
export function hundredthsToQty(h: bigint): string {
  const whole = h / 100n;
  const frac = (h % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
