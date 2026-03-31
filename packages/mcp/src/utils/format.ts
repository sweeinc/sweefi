import { COIN_TYPES, COIN_DECIMALS, TESTNET_COIN_TYPES } from "@sweefi/sui";
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
    const display = value.length > 100 ? value.slice(0, 100) + "…" : value;
    throw new Error(
      `${fieldName} must be a non-negative integer in base units (got "${display}"). ` +
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
 * Used for fields where zero is semantically valid (e.g., cumulativeCallCount=0 is a valid
 * initial state). Note: on-chain, dailyLimit=0 means zero budget, NOT unlimited (use u64::MAX).
 */
export function parseAmountOrZero(value: string, fieldName: string = "amount"): bigint {
  if (!value || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    const display = value.length > 100 ? value.slice(0, 100) + "…" : value;
    throw new Error(
      `${fieldName} must be a non-negative integer in base units (got "${display}"). ` +
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
/**
 * Abort codes rebuilt from Move contract source of truth.
 * Source files: contracts/sources/{payment,stream,escrow,seal_policy,mandate,agent_mandate,prepaid,identity,admin,math}.move
 *
 * admin.move uses 500-502, agent_mandate.move uses 550-560 (no collision).
 */
const ABORT_CODES: Record<number, { code: string; message: string; action: string; retryable: boolean; humanRequired: boolean }> = {
  // ── payment.move (0-2) ──────────────────────────────────────
  0:   { code: "INSUFFICIENT_PAYMENT", message: "Payment amount is less than required", action: "Increase the amount and retry", retryable: false, humanRequired: false },
  1:   { code: "ZERO_AMOUNT", message: "Amount cannot be zero", action: "Provide a positive amount", retryable: false, humanRequired: false },
  2:   { code: "INVALID_FEE_MICRO_PCT", message: "Fee micro-percent value is invalid (must be 0-1000000)", action: "Provide a valid feeMicroPercent between 0 and 1000000", retryable: false, humanRequired: false },

  // ── stream.move (100-110) ───────────────────────────────────
  100: { code: "STREAM_NOT_PAYER", message: "Signer is not the stream payer", action: "Use the wallet that created the stream", retryable: false, humanRequired: false },
  101: { code: "STREAM_NOT_RECIPIENT", message: "Signer is not the stream recipient", action: "Use the recipient wallet authorized in the stream", retryable: false, humanRequired: false },
  102: { code: "STREAM_INACTIVE", message: "Stream is not currently active", action: "The stream may have been stopped or closed. Check its status.", retryable: false, humanRequired: false },
  103: { code: "STREAM_ALREADY_ACTIVE", message: "Stream is already active", action: "Stop the existing stream before starting a new one", retryable: false, humanRequired: false },
  104: { code: "STREAM_ZERO_RATE", message: "Stream rate must be greater than zero", action: "Provide a positive rate_per_second value", retryable: false, humanRequired: false },
  105: { code: "STREAM_ZERO_DEPOSIT", message: "Stream deposit must be greater than zero", action: "Provide a positive deposit amount", retryable: false, humanRequired: false },
  106: { code: "STREAM_NOTHING_TO_CLAIM", message: "No funds available to claim from this stream", action: "Wait for more time to accrue before claiming again", retryable: true, humanRequired: false },
  107: { code: "STREAM_INVALID_FEE_MICRO_PCT", message: "Stream fee micro-percent is invalid", action: "Provide a valid feeMicroPercent between 0 and 1000000", retryable: false, humanRequired: false },
  108: { code: "STREAM_BUDGET_CAP_EXCEEDED", message: "Stream deposit exceeds budget cap", action: "Reduce the deposit amount or increase the budget cap", retryable: false, humanRequired: false },
  109: { code: "STREAM_TIMEOUT_NOT_REACHED", message: "Recipient close timeout has not been reached yet", action: "Wait for the timeout period to elapse before closing", retryable: true, humanRequired: false },
  110: { code: "STREAM_TIMEOUT_TOO_SHORT", message: "Recipient close timeout is too short", action: "Use a longer timeout value", retryable: false, humanRequired: false },
  111: { code: "STREAM_TIMEOUT_TOO_LONG", message: "Recipient close timeout is too long", action: "Use a shorter timeout value", retryable: false, humanRequired: false },

  // ── escrow.move (200-215) ───────────────────────────────────
  200: { code: "ESCROW_NOT_BUYER", message: "Signer is not the escrow buyer", action: "Use the buyer wallet that created the escrow", retryable: false, humanRequired: false },
  201: { code: "ESCROW_NOT_SELLER", message: "Signer is not the escrow seller", action: "Use the seller wallet specified in the escrow", retryable: false, humanRequired: false },
  202: { code: "ESCROW_NOT_ARBITER", message: "Signer is not the escrow arbiter", action: "Use the arbiter wallet specified in the escrow", retryable: false, humanRequired: false },
  203: { code: "ESCROW_NOT_AUTHORIZED", message: "Signer is not authorized for this escrow action", action: "Check which role (buyer/seller/arbiter) is required", retryable: false, humanRequired: false },
  204: { code: "ESCROW_DEADLINE_IN_PAST", message: "Escrow deadline is in the past", action: "Provide a future deadline timestamp", retryable: false, humanRequired: false },
  205: { code: "ESCROW_DEADLINE_NOT_REACHED", message: "Escrow deadline has not been reached", action: "Wait for the deadline to pass before taking this action", retryable: true, humanRequired: false },
  206: { code: "ESCROW_ALREADY_RESOLVED", message: "Escrow has already been resolved", action: "No action needed — the escrow was already completed", retryable: false, humanRequired: false },
  207: { code: "ESCROW_NOT_DISPUTED", message: "Escrow is not in disputed state", action: "The escrow must be disputed before an arbiter can resolve it", retryable: false, humanRequired: false },
  208: { code: "ESCROW_ALREADY_DISPUTED", message: "Escrow has already been disputed", action: "The dispute is already in progress — wait for arbiter resolution", retryable: false, humanRequired: false },
  209: { code: "ESCROW_ZERO_AMOUNT", message: "Escrow amount must be greater than zero", action: "Provide a positive escrow amount", retryable: false, humanRequired: false },
  210: { code: "ESCROW_INVALID_FEE_MICRO_PCT", message: "Escrow fee micro-percent is invalid", action: "Provide a valid feeMicroPercent between 0 and 1000000", retryable: false, humanRequired: false },
  211: { code: "ESCROW_DESCRIPTION_TOO_LONG", message: "Escrow description exceeds maximum length", action: "Shorten the description", retryable: false, humanRequired: false },
  212: { code: "ESCROW_ARBITER_IS_SELLER", message: "Arbiter cannot be the same address as the seller", action: "Use a different arbiter address", retryable: false, humanRequired: false },
  213: { code: "ESCROW_ARBITER_IS_BUYER", message: "Arbiter cannot be the same address as the buyer", action: "Use a different arbiter address", retryable: false, humanRequired: false },
  214: { code: "ESCROW_BUYER_IS_SELLER", message: "Buyer cannot be the same address as the seller", action: "Use a different buyer or seller address", retryable: false, humanRequired: false },
  215: { code: "ESCROW_DEADLINE_REACHED", message: "Escrow deadline has already passed — release is blocked", action: "The deadline has passed. The buyer can now refund the escrow instead.", retryable: false, humanRequired: false },

  // ── seal_policy.move (300) ──────────────────────────────────
  300: { code: "SEAL_NO_ACCESS", message: "Access denied by SEAL policy", action: "The payment receipt does not satisfy the SEAL access policy. Check that payment was made correctly.", retryable: false, humanRequired: false },

  // ── mandate.move (400-405) ──────────────────────────────────
  400: { code: "MANDATE_NOT_DELEGATE", message: "Signer is not the authorized delegate for this mandate", action: "Verify the mandate ID and that your wallet is the delegate", retryable: false, humanRequired: false },
  401: { code: "MANDATE_EXPIRED", message: "Mandate has expired", action: "This requires human authorization — inform the user that the mandate has expired and wait for them to create a new one. The agent cannot create or renew mandates.", retryable: false, humanRequired: true },
  402: { code: "MANDATE_PER_TX_EXCEEDED", message: "Amount exceeds the per-transaction spending limit", action: "Reduce the amount below the mandate's per-tx cap. Use sweefi_inspect_mandate to see the cap.", retryable: false, humanRequired: false },
  403: { code: "MANDATE_TOTAL_EXCEEDED", message: "Lifetime spending cap has been reached", action: "This requires human authorization — inform the user that the mandate budget is exhausted and wait for them to create a new mandate. The agent cannot renew mandates.", retryable: false, humanRequired: true },
  404: { code: "MANDATE_NOT_DELEGATOR", message: "Signer is not the delegator (owner) of this mandate", action: "Only the delegator can revoke mandates. Use the delegator wallet.", retryable: false, humanRequired: false },
  405: { code: "MANDATE_REVOKED", message: "Mandate has been revoked by the delegator", action: "This requires human authorization — inform the user. The mandate was intentionally revoked. Do not attempt to create a new mandate, use a different mandate, or retry. Wait for the user to respond.", retryable: false, humanRequired: true },

  // ── admin.move (500-503) ───────────────────────────────────
  500: { code: "ALREADY_PAUSED", message: "Protocol is already paused", action: "No action needed — the protocol is already in paused state", retryable: false, humanRequired: false },
  501: { code: "NOT_PAUSED", message: "Protocol is not paused", action: "The protocol must be paused before it can be unpaused", retryable: false, humanRequired: false },
  502: { code: "PROTOCOL_PAUSED", message: "Protocol is paused — new operations are blocked", action: "Wait for the protocol admin to unpause, or use exit operations (claim, close, withdraw) which are always allowed", retryable: true, humanRequired: true },
  503: { code: "AUTO_UNPAUSE_NOT_READY", message: "Auto-unpause window has not elapsed yet", action: "Wait for the 14-day auto-unpause window to pass, then call auto_unpause again", retryable: true, humanRequired: false },

  // ── agent_mandate.move (550-560) ──────────────────────────
  550: { code: "AGENT_MANDATE_NOT_DELEGATE", message: "Signer is not the authorized delegate for this agent mandate", action: "Verify the mandate ID and that your wallet is the delegate", retryable: false, humanRequired: false },
  551: { code: "AGENT_MANDATE_EXPIRED", message: "Agent mandate has expired", action: "This requires human authorization — inform the user that the mandate has expired. The agent cannot create or renew mandates.", retryable: false, humanRequired: true },
  552: { code: "AGENT_MANDATE_PER_TX_EXCEEDED", message: "Amount exceeds the agent mandate's per-transaction limit", action: "Reduce the amount below the mandate's per-tx cap. Use sweefi_inspect_mandate to see the cap.", retryable: false, humanRequired: false },
  553: { code: "AGENT_MANDATE_TOTAL_EXCEEDED", message: "Agent mandate lifetime spending cap has been reached", action: "This requires human authorization — inform the user that the mandate budget is exhausted. The agent cannot renew mandates.", retryable: false, humanRequired: true },
  554: { code: "AGENT_MANDATE_NOT_DELEGATOR", message: "Signer is not the delegator (owner) of this agent mandate", action: "Only the delegator can revoke mandates. Use the delegator wallet.", retryable: false, humanRequired: false },
  555: { code: "AGENT_MANDATE_REVOKED", message: "Agent mandate has been revoked by the delegator", action: "This requires human authorization — inform the user. The mandate was intentionally revoked. Do not retry. Wait for the user to respond.", retryable: false, humanRequired: true },
  556: { code: "AGENT_MANDATE_DAILY_EXCEEDED", message: "Daily spending limit reached on agent mandate", action: "Wait until tomorrow when the daily limit resets (lazy reset on first spend after midnight), or ask the user to create a new mandate with higher daily limits", retryable: true, humanRequired: false },
  557: { code: "AGENT_MANDATE_WEEKLY_EXCEEDED", message: "Weekly spending limit reached on agent mandate", action: "Wait until next week when the weekly limit resets (lazy reset on first spend after week boundary), or ask the user to create a new mandate with higher weekly limits", retryable: true, humanRequired: false },
  558: { code: "AGENT_MANDATE_INVALID_LEVEL", message: "Invalid autonomy level specified", action: "Use a valid level: 0 (read-only), 1 (monitor), 2 (capped), 3 (autonomous)", retryable: false, humanRequired: false },
  559: { code: "AGENT_MANDATE_LEVEL_NOT_AUTHORIZED", message: "Mandate autonomy level does not permit this action", action: "This mandate's level is too low for spending. L2+ is required for payments. Ask the user to upgrade the mandate level.", retryable: false, humanRequired: true },
  560: { code: "AGENT_MANDATE_CANNOT_DOWNGRADE", message: "Cannot downgrade agent mandate level", action: "Mandate levels can only be upgraded, not downgraded. To reduce permissions, revoke the mandate and create a new one.", retryable: false, humanRequired: true },

  // ── prepaid.move (600-622) ──────────────────────────────────
  600: { code: "PREPAID_NOT_AGENT", message: "Signer is not the agent (depositor) for this balance", action: "Use the correct wallet — the one that created the prepaid deposit", retryable: false, humanRequired: false },
  601: { code: "PREPAID_NOT_PROVIDER", message: "Signer is not the authorized provider", action: "Use the provider wallet that was authorized in the prepaid deposit", retryable: false, humanRequired: false },
  602: { code: "PREPAID_ZERO_DEPOSIT", message: "Deposit amount must be greater than zero", action: "Provide a positive deposit amount", retryable: false, humanRequired: false },
  603: { code: "PREPAID_ZERO_RATE", message: "Rate per call must be greater than zero", action: "Provide a positive rate_per_call value", retryable: false, humanRequired: false },
  604: { code: "PREPAID_WITHDRAWAL_LOCKED", message: "Funds cannot be withdrawn yet (grace period active)", action: "Wait for the withdrawal delay to pass, then call sweefi_prepaid_finalize_withdrawal. Use sweefi_prepaid_status to check when the grace period ends.", retryable: true, humanRequired: false },
  605: { code: "PREPAID_CALL_COUNT_REGRESSION", message: "Cumulative call count is less than the last claimed count", action: "The cumulativeCallCount must be >= the previously claimed count. Use sweefi_prepaid_status to see the current claimed_calls value.", retryable: false, humanRequired: false },
  606: { code: "PREPAID_MAX_CALLS_EXCEEDED", message: "Maximum call count has been exceeded", action: "Create a new prepaid balance with a higher max-calls value", retryable: false, humanRequired: false },
  607: { code: "PREPAID_RATE_LIMIT_EXCEEDED", message: "Claim would exceed the remaining balance at the configured rate", action: "The delta * rate_per_call exceeds remaining funds. Top up the prepaid balance or create a new deposit.", retryable: false, humanRequired: false },
  608: { code: "PREPAID_INVALID_FEE_MICRO_PCT", message: "Fee micro-percent value is invalid (must be 0-1000000)", action: "Provide a valid feeMicroPercent between 0 and 1000000", retryable: false, humanRequired: false },
  609: { code: "PREPAID_WITHDRAWAL_PENDING", message: "A withdrawal is already pending — top-ups and new deposits are blocked", action: "Cancel the pending withdrawal first with sweefi_prepaid_cancel_withdrawal, then retry", retryable: false, humanRequired: false },
  610: { code: "PREPAID_WITHDRAWAL_NOT_PENDING", message: "No withdrawal has been requested", action: "Call sweefi_prepaid_request_withdrawal first to initiate the withdrawal process", retryable: false, humanRequired: false },
  611: { code: "PREPAID_BALANCE_NOT_EXHAUSTED", message: "Cannot close PrepaidBalance — funds remain", action: "Use sweefi_prepaid_request_withdrawal to withdraw remaining funds, or wait for the provider to claim the remaining balance", retryable: false, humanRequired: false },
  612: { code: "PREPAID_WITHDRAWAL_DELAY_TOO_SHORT", message: "Withdrawal delay is below the minimum (60000 ms / 1 minute)", action: "Use a withdrawal delay of at least 60000 ms", retryable: false, humanRequired: false },
  613: { code: "PREPAID_WITHDRAWAL_DELAY_TOO_LONG", message: "Withdrawal delay exceeds the maximum (604800000 ms / 7 days)", action: "Use a withdrawal delay of at most 604800000 ms", retryable: false, humanRequired: false },
  614: { code: "PREPAID_INVALID_DISPUTE_WINDOW", message: "Dispute window is invalid (must be > 0 and ≤ withdrawal delay)", action: "Provide a valid dispute_window_ms value", retryable: false, humanRequired: false },
  615: { code: "PREPAID_NO_PENDING_CLAIM", message: "No pending claim exists to dispute or finalize", action: "The provider must submit a claim first before it can be disputed or finalized", retryable: false, humanRequired: false },
  616: { code: "PREPAID_CLAIM_NOT_FINALIZABLE", message: "Pending claim cannot be finalized yet (dispute window still open)", action: "Wait for the dispute window to close, then call finalize_claim", retryable: true, humanRequired: false },
  617: { code: "PREPAID_INVALID_FRAUD_PROOF", message: "Fraud proof is invalid — receipt does not prove overcharge", action: "Submit a valid signed receipt from the current batch that proves the provider claimed more calls than actually served", retryable: false, humanRequired: false },
  618: { code: "PREPAID_BALANCE_DISPUTED", message: "PrepaidBalance is in disputed state — claims are blocked", action: "The dispute must be resolved before new claims can be submitted", retryable: false, humanRequired: true },
  619: { code: "PREPAID_INVALID_PROVIDER_PUBKEY", message: "Provider public key is invalid", action: "Provide a valid Ed25519 public key (32 bytes)", retryable: false, humanRequired: false },
  620: { code: "PREPAID_PENDING_CLAIM_EXISTS", message: "A pending claim already exists — cannot withdraw or submit another claim", action: "Finalize or dispute the existing pending claim first", retryable: false, humanRequired: false },
  621: { code: "PREPAID_BALANCE_NOT_DISPUTED", message: "Balance is not in disputed state", action: "This action requires the balance to be disputed first", retryable: false, humanRequired: false },
  622: { code: "PREPAID_DISPUTE_WINDOW_EXPIRED", message: "Dispute window has expired — the claim can no longer be disputed", action: "The dispute window has closed. The pending claim will be finalized.", retryable: false, humanRequired: false },

  // ── identity.move (700-705) ─────────────────────────────────
  700: { code: "IDENTITY_ALREADY_REGISTERED", message: "This address already has a registered identity", action: "Each address can only have one identity. Use the existing identity or transfer it first.", retryable: false, humanRequired: false },
  701: { code: "IDENTITY_NOT_OWNER", message: "Signer is not the owner of this identity", action: "Use the wallet that owns the identity", retryable: false, humanRequired: false },
  702: { code: "IDENTITY_NOT_FOUND", message: "Identity not found for this address", action: "Register an identity first before performing this action", retryable: false, humanRequired: false },
  703: { code: "IDENTITY_INVALID_CREDENTIAL", message: "Invalid credential provided", action: "Check the credential format and try again", retryable: false, humanRequired: false },
  704: { code: "IDENTITY_MISMATCH", message: "Identity does not match the expected address", action: "Verify you are using the correct identity object for this address", retryable: false, humanRequired: false },
  705: { code: "IDENTITY_RECEIPT_ALREADY_RECORDED", message: "This receipt has already been recorded in the identity", action: "No action needed — the receipt is already linked", retryable: false, humanRequired: false },

  // ── math.move (900) ─────────────────────────────────────────
  900: { code: "MATH_OVERFLOW", message: "Arithmetic overflow in Move computation", action: "The values caused an overflow. Check that amounts are within valid ranges.", retryable: false, humanRequired: false },
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
  if (coinType.includes("::usdsui::USDSUI")) return "USDSUI";
  if (coinType === COIN_TYPES.USDT) return "USDT";
  // Truncate unknown types
  return coinType.length > 20 ? `${coinType.slice(0, 10)}...` : coinType;
}

/**
 * Resolve a user-friendly coin name to its full type string.
 * Accepts: "SUI", "USDC", "USDT", or a full type string.
 *
 * @param input  - Coin name or full type string
 * @param network - Sui network name (e.g., "testnet", "mainnet", "sui:testnet").
 *                  Used to return the correct USDC address per network (V8 audit F-05).
 */
export function resolveCoinType(input?: string, network?: string): string {
  if (!input) return COIN_TYPES.SUI;
  const upper = input.toUpperCase();
  if (upper === "SUI") return COIN_TYPES.SUI;
  if (upper === "USDC") {
    const isTestnet = network?.includes("testnet") ?? false;
    return isTestnet ? TESTNET_COIN_TYPES.USDC : COIN_TYPES.USDC;
  }
  if (upper === "USDSUI") return COIN_TYPES.USDSUI;
  if (upper === "USDT") return COIN_TYPES.USDT;
  return input; // assume it's a full type string
}
