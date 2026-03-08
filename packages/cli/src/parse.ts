/**
 * Input parsing utilities — amount, duration, address, coin type.
 *
 * The CLI accepts human-friendly inputs and converts to on-chain values:
 *   "1.5" SUI → 1_500_000_000 MIST (9 decimals)
 *   "10" USDC → 10_000_000 (6 decimals)
 *   "7d" → 604_800_000 ms
 */

import { COIN_TYPES, TESTNET_COIN_TYPES, COIN_DECIMALS } from "@sweefi/sui";
import { CliError } from "./context.js";

const SUI_ADDRESS_RE = /^0x[a-fA-F0-9]{64}$/;

/** Resolve "SUI", "USDC", "USDT" → full type string. Pass-through for full types. */
export function resolveCoinType(input?: string, network: string = "testnet"): string {
  if (!input) return COIN_TYPES.SUI;
  const upper = input.toUpperCase();
  if (upper === "SUI") return COIN_TYPES.SUI;
  if (upper === "USDC") return network === "mainnet" ? COIN_TYPES.USDC : TESTNET_COIN_TYPES.USDC;
  if (upper === "USDSUI") return COIN_TYPES.USDSUI;
  if (upper === "USDT") return COIN_TYPES.USDT;
  return input;
}

/**
 * Parse a human-readable amount into base units.
 *   "1.5" with SUI (9 decimals) → 1_500_000_000n
 *   "10"  with USDC (6 decimals) → 10_000_000n
 */
export function parseAmount(value: string, coinType: string): bigint {
  if (!value || value.trim() === "") {
    throw new CliError("INVALID_AMOUNT", "Amount is required", false, "Provide a positive number like '1.5'");
  }

  const trimmed = value.trim();

  // Reject scientific notation, Infinity, and hex literals — they slip past Number() checks.
  // Number("0x10") = 16 in JS, which would silently accept addresses as amounts.
  if (/[eE]/.test(trimmed) || /^[+-]?Infinity$/.test(trimmed) || /^0[xX]/.test(trimmed)) {
    throw new CliError("INVALID_AMOUNT", `Invalid amount: "${value}"`, false, "Use a plain number like '1.5' or '1500000000'");
  }

  // Allow pure integer base units (for power users / agents that already computed)
  if (/^\d+$/.test(trimmed) && trimmed.length > 10) {
    const result = BigInt(trimmed);
    if (result === 0n) {
      throw new CliError("INVALID_AMOUNT", "Amount must be greater than zero", false, "Provide a positive number like '1.5'");
    }
    return result;
  }

  const num = Number(trimmed);
  if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) {
    throw new CliError("INVALID_AMOUNT", `Invalid amount: "${value}"`, false, "Provide a positive number like '1.5' or '100'");
  }

  const decimals = COIN_DECIMALS[coinType] ?? 9;
  const factor = BigInt(10 ** decimals);

  // Handle decimal amounts precisely by splitting on "."
  const parts = trimmed.split(".");
  const whole = BigInt(parts[0]) * factor;
  if (parts.length === 1) return whole;

  const fracStr = parts[1].padEnd(decimals, "0").slice(0, decimals);
  const result = whole + BigInt(fracStr);

  // Catch silent truncation: "0.0000000001" with 9 decimals → 0n
  if (result === 0n) {
    throw new CliError("INVALID_AMOUNT", `Amount "${value}" is too small (${decimals} decimal places max)`, false, `Minimum is 0.${"0".repeat(decimals - 1)}1`);
  }
  return result;
}

/**
 * Parse a human-friendly duration into milliseconds.
 *   "7d" → 604_800_000
 *   "24h" → 86_400_000
 *   "30m" → 1_800_000
 *   Raw number treated as milliseconds.
 */
export function parseDuration(value: string): bigint {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(d|h|m|ms|s)?$/);
  if (!match) {
    throw new CliError("INVALID_DURATION", `Invalid duration: "${value}"`, false, 'Use formats like "7d", "24h", "30m", or "3600000"');
  }

  const num = Number(match[1]);
  const unit = match[2] ?? "ms";

  // Guard: astronomically large digit strings overflow Number to Infinity.
  // BigInt(Math.floor(Infinity)) throws RangeError — catch it here as CliError.
  if (!Number.isFinite(num)) {
    throw new CliError("INVALID_DURATION", `Invalid duration: "${value}"`, false, 'Use formats like "7d", "24h", "30m", or "3600000"');
  }

  const multipliers: Record<string, number> = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
    ms: 1,
  };

  const ms = BigInt(Math.floor(num * multipliers[unit]));
  if (ms <= 0n) {
    throw new CliError("INVALID_DURATION", "Duration must be greater than zero", false, 'Use formats like "7d", "24h", "30m"');
  }
  return ms;
}

/** Validate a Sui address (0x + 64 hex chars). */
export function validateAddress(input: string, label: string): string {
  if (!SUI_ADDRESS_RE.test(input)) {
    throw new CliError(
      "INVALID_ADDRESS",
      `${label} is not a valid Sui address: "${input}"`,
      false,
      "Sui addresses are 0x followed by 64 hex characters",
    );
  }
  return input;
}

/** Validate a Sui object ID (0x + hex, at least 1 char). */
export function validateObjectId(input: string, label: string): string {
  if (!/^0x[a-fA-F0-9]+$/.test(input)) {
    throw new CliError("INVALID_OBJECT_ID", `${label} is not a valid object ID: "${input}"`, false, "Object IDs start with 0x followed by hex characters");
  }
  return input;
}

/** Safely convert a string flag to BigInt with bounds checking. */
export function parseBigIntFlag(value: string, label: string, opts?: { min?: bigint }): bigint {
  if (!value || value.trim() === "") {
    throw new CliError("INVALID_VALUE", `${label} is required`, false, "Provide a whole number");
  }
  try {
    const result = BigInt(value);
    if (opts?.min !== undefined && result < opts.min) {
      throw new CliError("INVALID_VALUE", `${label} must be at least ${opts.min}`, false, `Got: ${value}`);
    }
    return result;
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError("INVALID_VALUE", `Invalid ${label}: "${value}"`, false, "Provide a whole number");
  }
}

/**
 * Known Move abort codes → structured CLI errors.
 * Lets agents self-recover instead of seeing opaque "MoveAbort" strings.
 */
const ABORT_CODES: Record<number, { code: string; message: string; action: string; retryable: boolean; humanRequired: boolean }> = {
  // Payment
  0:   { code: "INSUFFICIENT_PAYMENT", message: "Payment amount is less than required", action: "Increase the amount and retry", retryable: false, humanRequired: false },
  1:   { code: "ZERO_AMOUNT", message: "Amount cannot be zero", action: "Provide a positive amount", retryable: false, humanRequired: false },
  // Mandate — agent is the delegate, human is the delegator
  400: { code: "MANDATE_NOT_DELEGATE", message: "Signer is not the authorized delegate for this mandate", action: "Run 'sweefi mandate check <mandateId>' to verify the delegate address matches your wallet", retryable: false, humanRequired: false },
  401: { code: "MANDATE_EXPIRED", message: "Mandate has expired", action: "This requires human authorization — inform the user that the mandate has expired and wait for them to create a new one. The agent cannot create or renew mandates.", retryable: false, humanRequired: true },
  402: { code: "MANDATE_PER_TX_EXCEEDED", message: "Amount exceeds the per-transaction spending limit", action: "Run 'sweefi mandate check <mandateId>' to see the per-tx cap, then reduce the amount below it. If the full amount is required, inform the user and wait for them to raise the cap.", retryable: false, humanRequired: false },
  403: { code: "MANDATE_TOTAL_EXCEEDED", message: "Lifetime spending cap has been reached", action: "This requires human authorization — inform the user that the mandate budget is exhausted and wait for them to create a new mandate. The agent cannot renew mandates.", retryable: false, humanRequired: true },
  405: { code: "MANDATE_REVOKED", message: "Mandate has been revoked by the delegator", action: "This requires human authorization — inform the user. The mandate was intentionally revoked. Do not attempt to create a new mandate, use a different mandate, or retry. Wait for the user to respond.", retryable: false, humanRequired: true },
  // Prepaid
  600: { code: "PREPAID_NOT_AGENT", message: "Signer is not the agent (depositor) for this balance", action: "Use the correct wallet — the one that created the prepaid deposit", retryable: false, humanRequired: false },
  601: { code: "PREPAID_NOT_PROVIDER", message: "Signer is not the authorized provider", action: "Use the provider wallet that was authorized in the prepaid deposit", retryable: false, humanRequired: false },
  604: { code: "PREPAID_WITHDRAWAL_LOCKED", message: "Funds cannot be withdrawn yet (grace period active)", action: "Wait for the withdrawal delay to pass, then retry", retryable: true, humanRequired: false },
  606: { code: "PREPAID_MAX_CALLS_EXCEEDED", message: "Maximum call count has been exceeded", action: "Create a new prepaid balance with 'sweefi prepaid deposit' and a higher --max-calls value", retryable: false, humanRequired: false },
  607: { code: "PREPAID_RATE_EXCEEDED", message: "Claim amount exceeds available balance", action: "Check remaining balance with 'sweefi prepaid status <balanceId>'. Top up or create a new prepaid deposit.", retryable: false, humanRequired: false },
};

/** Assert a transaction succeeded on-chain. */
export function assertTxSuccess(result: { effects?: { status?: { status: string; error?: string } } | null }): void {
  const status = result.effects?.status?.status;
  if (status !== "success") {
    const error = result.effects?.status?.error ?? "Unknown error";

    // Try to extract Move abort code for structured error
    const abortMatch = error.match(/MoveAbort.*?(\d+)/);
    if (abortMatch) {
      const abortCode = Number(abortMatch[1]);
      const known = ABORT_CODES[abortCode];
      if (known) {
        throw new CliError(known.code, known.message, known.retryable, known.action, known.humanRequired);
      }
    }

    // Classify into specific sub-codes for agent retry decisions
    if (/InsufficientGas|out of gas/i.test(error)) {
      throw new CliError("TX_OUT_OF_GAS", `Transaction ran out of gas: ${error}`, true, "Retry with a higher gas budget");
    }
    if (/ObjectVersionUnavailableForConsumption|SharedObjectLockContentious|concurrency/i.test(error)) {
      throw new CliError("TX_OBJECT_CONFLICT", `Concurrent object access: ${error}`, true, "This is transient — retry in a few seconds", false);
    }
    throw new CliError("TX_EXECUTION_ERROR", `Transaction failed on-chain: ${error}`, false, "Check the transaction on the explorer for details");
  }
}

/** @deprecated Use gasUsedSui from output.ts instead. Kept only for backward compat if imported externally. */
export function gasUsedSui(result: { effects?: { gasUsed?: { computationCost: string; storageCost: string; storageRebate: string } } | null }): string {
  const gas = result.effects?.gasUsed;
  if (!gas) return "unknown";
  const total = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  const sui = Number(total) / 1e9;
  return sui.toFixed(6);
}
