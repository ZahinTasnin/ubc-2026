/**
 * Monetary conventions (PRELIMINARY — refine with all devs).
 *
 * - Token amounts are integer BASE UNITS carried as decimal STRINGS (JSON-safe, no float, no
 *   bigint serialization issues). Convert with BigInt at the edges.
 * - Mock USD stablecoin has 6 decimals: 5 tokens = "5000000".
 * - Prediction-market prices are integer MICRO-USD per $1-payout contract: $0.34 = "340000".
 */
export type Base10Integer = string & { readonly __brand?: "Base10Integer" };

/** Mock USD SPL token base units (6 decimals). Valueless Devnet test token. */
export type TokenBaseUnits = Base10Integer;

/** Price of one $1-payout YES contract, in micro-USD (1_000_000 = $1.00). */
export type PriceMicroUsd = Base10Integer;

/** Solana public key / transaction signature as base58 string. */
export type Base58 = string;

/** ISO-8601 timestamp string. */
export type IsoTimestamp = string;

export const MOCK_USD_DECIMALS = 6;
/** Demo offer: 5 mock stablecoins in base units. */
export const DEMO_PURCHASE_AMOUNT: TokenBaseUnits = "5000000";
/** One YES contract pays $1 = 1_000_000 micro-USD. */
export const CONTRACT_PAYOUT_MICRO_USD: PriceMicroUsd = "1000000";
