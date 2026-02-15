import { COIN_TYPES, COIN_DECIMALS } from "@sweepay/core";
import { z } from "zod";

/** 64-char zero address — used as default feeRecipient when no fee is charged */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Regex for a valid Sui address (0x + 64 hex chars) */
const SUI_ADDRESS_RE = /^0x[a-fA-F0-9]{64}$/;

/** Zod schema for a required Sui address with validation */
export const suiAddress = (label: string) =>
  z.string().regex(SUI_ADDRESS_RE, `${label} must be a valid Sui address (0x + 64 hex chars)`).describe(`${label} Sui address (0x...)`);

/** Zod schema for an optional Sui address with validation */
export const optionalSuiAddress = (label: string) =>
  z.string().regex(SUI_ADDRESS_RE, `${label} must be a valid Sui address (0x + 64 hex chars)`).optional().describe(`${label} Sui address (0x...)`);

/**
 * Validate and parse an amount string into a bigint.
 * Prevents negative amounts, floats, non-numeric strings, and zero values
 * from reaching BigInt() and producing confusing errors or silent wrapping.
 */
export function parseAmount(value: string, fieldName: string = "amount"): bigint {
  if (!value || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${fieldName} must be a non-negative integer in base units (got "${value}"). ` +
        `For 1 SUI, use "1000000000" (9 decimals). For 1 USDC, use "1000000" (6 decimals).`,
    );
  }
  const result = BigInt(trimmed);
  if (result === 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return result;
}

/**
 * Assert that a Sui transaction succeeded.
 * Throws with the on-chain error message if the transaction reverted.
 */
export function assertTxSuccess(result: { effects?: { status?: { status: string; error?: string } } | null }): void {
  const status = result.effects?.status?.status;
  if (status !== "success") {
    const error = result.effects?.status?.error ?? "Unknown error";
    throw new Error(
      `Transaction failed on-chain: ${error}. ` +
        `Check the transaction digest on the explorer for details.`,
    );
  }
}

/**
 * Format a balance from base units to human-readable string.
 * E.g., 1_000_000_000 MIST → "1.0 SUI"
 */
export function formatBalance(amount: string | bigint, coinType: string): string {
  const decimals = COIN_DECIMALS[coinType] ?? 9;
  const raw = BigInt(amount);
  const whole = raw / BigInt(10 ** decimals);
  const frac = raw % BigInt(10 ** decimals);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "") || "0";

  const symbol = getSymbol(coinType);
  return `${whole}.${fracStr} ${symbol}`;
}

/**
 * Get a human-readable symbol for a coin type.
 */
export function getSymbol(coinType: string): string {
  if (coinType === COIN_TYPES.SUI || coinType.endsWith("::sui::SUI")) return "SUI";
  if (coinType === COIN_TYPES.USDC || coinType.includes("::usdc::USDC")) return "USDC";
  if (coinType === COIN_TYPES.USDT || coinType.includes("::coin::COIN")) return "USDT";
  // Truncate unknown types
  return coinType.length > 20 ? `${coinType.slice(0, 10)}...` : coinType;
}

/**
 * Resolve a user-friendly coin name to its full type string.
 * Accepts: "SUI", "USDC", "USDT", or a full type string.
 */
export function resolveCoinType(input?: string): string {
  if (!input) return COIN_TYPES.SUI;
  const upper = input.toUpperCase();
  if (upper === "SUI") return COIN_TYPES.SUI;
  if (upper === "USDC") return COIN_TYPES.USDC;
  if (upper === "USDT") return COIN_TYPES.USDT;
  return input; // assume it's a full type string
}
