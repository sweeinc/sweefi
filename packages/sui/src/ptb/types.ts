/**
 * Configuration for interacting with deployed SweeFi contracts.
 * Each network has its own package ID — pass the right one for your environment.
 */
export interface SweefiConfig {
  /** On-chain package address (e.g., "0xabc...def") */
  packageId: string;
  /**
   * Shared ProtocolState object ID. Required for stream/escrow create operations.
   * Not needed for payment-only usage (payments use owned objects, no pause guard).
   */
  protocolStateId?: string;
}

// ══════════════════════════════════════════════════════════════
// Admin types
// ══════════════════════════════════════════════════════════════

/** Parameters for admin operations (pause, unpause, burn) */
export interface AdminParams {
  /** AdminCap object ID (owned by deployer) */
  adminCapId: string;
  /** Sender address (must own the AdminCap) */
  sender: string;
}

// ══════════════════════════════════════════════════════════════
// Payment types
// ══════════════════════════════════════════════════════════════

/** Parameters for direct payment (pay_and_keep entry function) */
export interface PayParams {
  /** Coin type (e.g., "0x2::sui::SUI", USDC address) */
  coinType: string;
  /** Sender (payer) address */
  sender: string;
  /** Recipient address */
  recipient: string;
  /** Amount in smallest units (MIST for SUI, base units for USDC) */
  amount: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%). See assert.ts for common values. */
  feeMicroPercent: number;
  /** Address that receives the fee */
  feeRecipient: string;
  /** Optional memo (UTF-8 string or raw bytes) */
  memo?: string | Uint8Array;
}

/** Parameters for invoice creation */
export interface CreateInvoiceParams {
  /** Sender (creator) address */
  sender: string;
  /** Payment recipient address */
  recipient: string;
  /** Expected payment amount in smallest units */
  expectedAmount: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%). See assert.ts for common values. */
  feeMicroPercent: number;
  /** Address that receives the fee */
  feeRecipient: string;
  /** If provided, invoice is transferred to this address */
  sendTo?: string;
}

/** Parameters for invoice payment */
export interface PayInvoiceParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (payer) address */
  sender: string;
  /** Invoice object ID */
  invoiceId: string;
  /** Amount to send (must be >= invoice.expected_amount). Used for coin selection. */
  amount: bigint;
}

// ══════════════════════════════════════════════════════════════
// Stream types
// ══════════════════════════════════════════════════════════════

/** Parameters for stream creation */
export interface CreateStreamParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (payer) address */
  sender: string;
  /** Stream recipient address */
  recipient: string;
  /** Initial deposit amount in smallest units */
  depositAmount: bigint;
  /** Payment rate in tokens per second */
  ratePerSecond: bigint;
  /** Maximum total spend (gross, including fees) */
  budgetCap: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%). See assert.ts for common values. */
  feeMicroPercent: number;
  /** Address that receives the fee on claims */
  feeRecipient: string;
}

/**
 * Parameters for stream creation with configurable recipient_close timeout.
 * Extends CreateStreamParams with a custom timeout for abandoned stream recovery.
 * Minimum: 86,400,000 ms (1 day). Default if not specified: 604,800,000 ms (7 days).
 */
export interface CreateStreamWithTimeoutParams extends CreateStreamParams {
  /** Recipient close timeout in milliseconds. Minimum 1 day (86_400_000). */
  recipientCloseTimeoutMs: bigint;
}

/** Parameters for stream operations that require the meter */
export interface StreamOpParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** StreamingMeter object ID */
  meterId: string;
  /** Sender address (payer for pause/resume/close, recipient for claim) */
  sender: string;
}

/** Parameters for stream top-up */
export interface StreamTopUpParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** StreamingMeter object ID */
  meterId: string;
  /** Sender (payer) address */
  sender: string;
  /** Additional deposit amount in smallest units */
  depositAmount: bigint;
}

/**
 * Parameters for batch-claiming from multiple streams in a single PTB.
 * All streams must use the same coin type (type argument is shared).
 * This reduces gas overhead by 60-70% per stream vs individual claims.
 */
export interface BatchClaimParams {
  /** Coin type — all streams must use the same type */
  coinType: string;
  /** StreamingMeter object IDs to claim from */
  meterIds: string[];
  /** Sender (recipient) address — must be recipient on all streams */
  sender: string;
}

// ══════════════════════════════════════════════════════════════
// Prepaid types
// ══════════════════════════════════════════════════════════════

/**
 * Parameters for creating a prepaid balance (agent deposits funds).
 *
 * Trust model: The provider submits cumulative call counts. Move enforces
 * rate_per_call and max_calls caps, but cannot verify actual API calls.
 * The deposit amount is the agent's maximum possible loss.
 */
export interface PrepaidDepositParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (agent) address */
  sender: string;
  /** Provider (authorized claimer) address */
  provider: string;
  /** Deposit amount in base units */
  amount: bigint;
  /** Maximum base units per call (rate cap) */
  ratePerCall: bigint;
  /** Max calls cap. Omit or use UNLIMITED_CALLS for no limit. */
  maxCalls?: bigint | string;
  /** How long agent must wait after last claim to withdraw (ms). Min 60s, max 7d. */
  withdrawalDelayMs: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%). See assert.ts for common values. */
  feeMicroPercent: number;
  /** Address that receives the protocol fee */
  feeRecipient: string;
}

/** Parameters for provider claiming earned funds */
export interface PrepaidClaimParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender (provider) address */
  sender: string;
  /** Total cumulative calls served (Move computes delta from last claim) */
  cumulativeCallCount: bigint;
}

/** Parameters for prepaid operations (withdrawal, cancel, close) */
export interface PrepaidOpParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender address (agent for withdrawal, provider for provider_close) */
  sender: string;
}

/** Parameters for agent topping up an existing prepaid balance */
export interface PrepaidTopUpParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender (agent) address */
  sender: string;
  /** Additional deposit amount in base units */
  amount: bigint;
}

// ══════════════════════════════════════════════════════════════
// Prepaid v0.2 types (signed receipts / fraud proofs)
// ══════════════════════════════════════════════════════════════

/**
 * Parameters for creating a v0.2 prepaid balance with signed receipt support.
 * Extends PrepaidDepositParams with provider's Ed25519 public key and dispute window.
 */
export interface PrepaidDepositWithReceiptsParams extends PrepaidDepositParams {
  /** Provider's Ed25519 public key (32 bytes, hex-encoded with 0x prefix) */
  providerPubkey: string;
  /** Dispute window in milliseconds. Min 60s (60000), max 24h (86400000). */
  disputeWindowMs: bigint;
}

/** Parameters for finalizing a pending claim (permissionless) */
export interface PrepaidFinalizeClaimParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender address (anyone can call — permissionless) */
  sender: string;
}

/** Parameters for disputing a pending claim with a fraud proof */
export interface PrepaidDisputeClaimParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender (agent) address */
  sender: string;
  /** Balance ID from the receipt (must match balanceId) */
  receiptBalanceId: string;
  /** Call number from the signed receipt */
  receiptCallNumber: bigint;
  /** Timestamp from the signed receipt */
  receiptTimestampMs: bigint;
  /** Response hash from the signed receipt */
  receiptResponseHash: Uint8Array;
  /** Ed25519 signature over the receipt message (64 bytes) */
  signature: Uint8Array;
}

/** Parameters for withdrawing from a disputed balance (agent only, immediate) */
export interface PrepaidWithdrawDisputedParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** PrepaidBalance object ID */
  balanceId: string;
  /** Sender (agent) address */
  sender: string;
}
