/**
 * Configuration for interacting with deployed SweePay contracts.
 * Each network has its own package ID — pass the right one for your environment.
 */
export interface SweepayConfig {
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
  /** Facilitator fee in basis points (0-10000) */
  feeBps: number;
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
  /** Fee in basis points (0-10000) */
  feeBps: number;
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
  /** Fee in basis points (0-10000) */
  feeBps: number;
  /** Address that receives the fee on claims */
  feeRecipient: string;
}

/**
 * Parameters for stream creation with configurable recipient_close timeout (v6).
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
