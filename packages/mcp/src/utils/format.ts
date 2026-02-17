import { COIN_TYPES, COIN_DECIMALS } from "@sweepay/core";
import { z } from "zod";

/** 64-char zero address — used as default feeRecipient when no fee is charged */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Regex for a valid Sui address (0x + 64 hex chars) */
const SUI_ADDRESS_RE = /^0x[a-fA-F0-9]{64}$/;

/** Zod schema for a required Sui address with validation */
export const suiAddress = (label: string) =>
  z.string().regex(SUI_ADDRESS_RE, `${label} must be a valid Sui address (0x + 64 hex chars)`).describe(`${label} Sui address (0x...)`);

/** Zod schema for a Sui object ID with validation (same format as address) */
export const suiObjectId = (label: string) =>
  z.string().regex(SUI_ADDRESS_RE, `${label} must be a valid Sui object ID (0x + 64 hex chars)`).describe(`${label} Sui object ID (0x...)`);

/** Zod schema for an optional Sui address with validation */
export const optionalSuiAddress = (label: string) =>
  z.string().regex(SUI_ADDRESS_RE, `${label} must be a valid Sui address (0x + 64 hex chars)`).optional().describe(`${label} Sui address (0x...)`);

/**
 * Validate and parse an amount string into a bigint.
 * Prevents negative amounts, floats, non-numeric strings, and zero values
 * from reaching BigInt() and producing confusing errors or silent wrapping.
 */
/** Maximum value for a u64 on Sui (2^64 - 1). Values above this wrap to 0 in BCS serialization. */
const U64_MAX = 18_446_744_073_709_551_615n;

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
  if (result > U64_MAX) {
    throw new Error(
      `${fieldName} exceeds u64::MAX (${U64_MAX}). Got: ${result}. ` +
        `Values above u64::MAX would wrap to 0 in BCS serialization.`,
    );
  }
  return result;
}

/**
 * Like parseAmount but allows zero values.
 * Used for fields where zero is semantically valid (e.g., dailyLimit=0 means "unlimited",
 * cumulativeCallCount=0 is a safe no-op).
 */
export function parseAmountOrZero(value: string, fieldName: string = "amount"): bigint {
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
  if (result > U64_MAX) {
    throw new Error(
      `${fieldName} exceeds u64::MAX (${U64_MAX}). Got: ${result}. ` +
        `Values above u64::MAX would wrap to 0 in BCS serialization.`,
    );
  }
  return result;
}

/**
 * Known Move abort codes → structured error messages for LLM agents.
 * Mirrors the CLI's ABORT_CODES table so MCP clients get the same quality.
 */
const ABORT_CODES: Record<number, { code: string; message: string; action: string; retryable: boolean; humanRequired: boolean }> = {
  // Payment
  0:   { code: "INSUFFICIENT_PAYMENT", message: "Payment amount is less than required", action: "Increase the amount and retry", retryable: false, humanRequired: false },
  1:   { code: "ZERO_AMOUNT", message: "Amount cannot be zero", action: "Provide a positive amount", retryable: false, humanRequired: false },
  // Mandate
  400: { code: "MANDATE_NOT_DELEGATE", message: "Signer is not the authorized delegate for this mandate", action: "Verify the mandate ID and that your wallet is the delegate", retryable: false, humanRequired: false },
  401: { code: "MANDATE_EXPIRED", message: "Mandate has expired", action: "This requires human authorization — inform the user that the mandate has expired and wait for them to create a new one. The agent cannot create or renew mandates.", retryable: false, humanRequired: true },
  402: { code: "MANDATE_PER_TX_EXCEEDED", message: "Amount exceeds the per-transaction spending limit", action: "Reduce the amount below the mandate's per-tx cap. Use sweepay_get_receipt or query the mandate object to see the cap.", retryable: false, humanRequired: false },
  403: { code: "MANDATE_TOTAL_EXCEEDED", message: "Lifetime spending cap has been reached", action: "This requires human authorization — inform the user that the mandate budget is exhausted and wait for them to create a new mandate. The agent cannot renew mandates.", retryable: false, humanRequired: true },
  405: { code: "MANDATE_REVOKED", message: "Mandate has been revoked by the delegator", action: "This requires human authorization — inform the user. The mandate was intentionally revoked. Do not attempt to create a new mandate, use a different mandate, or retry. Wait for the user to respond.", retryable: false, humanRequired: true },
  // Agent Mandate
  506: { code: "AGENT_MANDATE_NOT_DELEGATE", message: "Signer is not the authorized delegate for this agent mandate", action: "Verify the mandate ID and that your wallet is the delegate", retryable: false, humanRequired: false },
  507: { code: "AGENT_MANDATE_EXPIRED", message: "Agent mandate has expired", action: "This requires human authorization — inform the user that the mandate has expired. The agent cannot create or renew mandates.", retryable: false, humanRequired: true },
  508: { code: "AGENT_MANDATE_PER_TX_EXCEEDED", message: "Amount exceeds the agent mandate's per-transaction limit", action: "Reduce the amount below the mandate's per-tx cap", retryable: false, humanRequired: false },
  509: { code: "AGENT_MANDATE_DAILY_EXCEEDED", message: "Daily spending limit reached on agent mandate", action: "Wait until tomorrow when the daily limit resets (lazy reset on first spend), or ask the user to create a new mandate with higher daily limits", retryable: true, humanRequired: false },
  510: { code: "AGENT_MANDATE_WEEKLY_EXCEEDED", message: "Weekly spending limit reached on agent mandate", action: "Wait until next week when the weekly limit resets (lazy reset on first spend), or ask the user to create a new mandate with higher weekly limits", retryable: true, humanRequired: false },
  // Prepaid
  600: { code: "PREPAID_NOT_AGENT", message: "Signer is not the agent (depositor) for this balance", action: "Use the correct wallet — the one that created the prepaid deposit", retryable: false, humanRequired: false },
  601: { code: "PREPAID_NOT_PROVIDER", message: "Signer is not the authorized provider", action: "Use the provider wallet that was authorized in the prepaid deposit", retryable: false, humanRequired: false },
  602: { code: "PREPAID_BALANCE_NOT_EXHAUSTED", message: "Cannot close PrepaidBalance — funds remain", action: "Withdraw remaining funds first, or wait for the provider to claim all remaining balance", retryable: false, humanRequired: false },
  603: { code: "PREPAID_NO_WITHDRAWAL_PENDING", message: "No withdrawal has been requested", action: "Call sweepay_prepaid_request_withdrawal first to initiate the withdrawal process", retryable: false, humanRequired: false },
  604: { code: "PREPAID_WITHDRAWAL_LOCKED", message: "Funds cannot be withdrawn yet (grace period active)", action: "Wait for the withdrawal delay to pass, then retry", retryable: true, humanRequired: false },
  605: { code: "PREPAID_WITHDRAWAL_PENDING", message: "A withdrawal is already pending — top-ups are blocked", action: "Cancel the pending withdrawal first with sweepay_prepaid_cancel_withdrawal, then retry", retryable: false, humanRequired: false },
  606: { code: "PREPAID_MAX_CALLS_EXCEEDED", message: "Maximum call count has been exceeded", action: "Create a new prepaid balance with a higher max-calls value", retryable: false, humanRequired: false },
  607: { code: "PREPAID_RATE_EXCEEDED", message: "Claim amount exceeds available balance", action: "Top up the prepaid balance or create a new prepaid deposit", retryable: false, humanRequired: false },
  608: { code: "PREPAID_ZERO_DEPOSIT", message: "Deposit amount must be greater than zero", action: "Provide a positive deposit amount", retryable: false, humanRequired: false },
  609: { code: "PREPAID_ZERO_RATE", message: "Rate per call must be greater than zero", action: "Provide a positive rate_per_call value", retryable: false, humanRequired: false },
  610: { code: "PREPAID_INVALID_MAX_CALLS", message: "Max calls must be greater than zero", action: "Provide a positive max_calls value or omit for unlimited", retryable: false, humanRequired: false },
  611: { code: "PREPAID_INVALID_DELAY", message: "Withdrawal delay is outside the allowed range", action: "Use a delay between 60000 (1 min) and 604800000 (7 days)", retryable: false, humanRequired: false },
  612: { code: "PREPAID_ZERO_TOP_UP", message: "Top-up amount must be greater than zero", action: "Provide a positive top-up amount", retryable: false, humanRequired: false },
  613: { code: "PREPAID_ALREADY_PENDING", message: "A withdrawal is already pending", action: "Wait for the current withdrawal to complete or cancel it first", retryable: false, humanRequired: false },
  // Stream
  106: { code: "STREAM_NOTHING_TO_CLAIM", message: "No funds available to claim from this stream", action: "Wait for more time to accrue before claiming again", retryable: true, humanRequired: false },
  // Escrow
  206: { code: "ESCROW_ALREADY_RESOLVED", message: "Escrow has already been resolved", action: "No action needed — the escrow was already completed", retryable: false, humanRequired: false },
};

/**
 * Assert that a Sui transaction succeeded.
 * Parses Move abort codes into structured error messages that LLM agents can act on.
 * The error message includes JSON so MCP clients get machine-readable recovery guidance.
 */
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
        throw new Error(
          `${known.code}: ${known.message}\n\n` +
            JSON.stringify({
              code: known.code,
              message: known.message,
              retryable: known.retryable,
              requiresHumanAction: known.humanRequired,
              suggestedAction: known.action,
            }),
        );
      }
    }

    throw new Error(
      `TX_FAILED: Transaction failed on-chain: ${error}\n\n` +
        JSON.stringify({
          code: "TX_FAILED",
          message: `Transaction failed on-chain: ${error}`,
          retryable: false,
          requiresHumanAction: false,
          suggestedAction: "Check the transaction digest on the explorer for details",
        }),
    );
  }
}

/**
 * Format a balance from base units to human-readable string.
 * E.g., 1_000_000_000 MIST → "1.0 SUI"
 */
export function formatBalance(amount: string | bigint, coinType: string): string {
  if (amount === undefined || amount === null || amount === "") {
    throw new Error("formatBalance: amount is required");
  }
  const decimals = COIN_DECIMALS[coinType] ?? 9;
  let raw: bigint;
  try {
    raw = BigInt(amount);
  } catch {
    throw new Error(`formatBalance: invalid amount "${amount}" — must be a non-negative integer`);
  }
  if (raw < 0n) {
    throw new Error(`formatBalance: amount must be non-negative, got ${raw}`);
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
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
  if (coinType === COIN_TYPES.USDT) return "USDT";
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
