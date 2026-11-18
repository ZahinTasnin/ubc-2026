import { MOCK_USD_DECIMALS, type TokenBaseUnits } from "@hedged/shared";

/**
 * Formats a token amount (integer base units as a string) as US dollars, e.g. "5000000" -> "$5.00".
 *
 * Uses BigInt only, so large amounts stay exact (no floating point). Rounds half up to the cent.
 * Throws if the input is not a non-negative integer string, so bad data is never shown as money.
 */
export function formatTokenAmount(baseUnits: TokenBaseUnits): string {
  if (!/^\d+$/.test(baseUnits)) {
    throw new Error(`formatTokenAmount: expected non-negative integer string, got "${baseUnits}"`);
  }

  // 1 cent = 10^(decimals - 2) base units (10_000 for 6 decimals).
  const baseUnitsPerCent = 10n ** BigInt(MOCK_USD_DECIMALS - 2);

  // Integer division after adding half a cent rounds to the nearest cent.
  const totalCents = (BigInt(baseUnits) + baseUnitsPerCent / 2n) / baseUnitsPerCent;

  const dollars = totalCents / 100n;
  const cents = (totalCents % 100n).toString().padStart(2, "0");

  // Add thousands separators to the dollar part ("1000" -> "1,000").
  const dollarsWithCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `$${dollarsWithCommas}.${cents}`;
}
