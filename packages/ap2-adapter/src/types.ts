/**
 * AP2 (Agent Payments Protocol) types — translated from Python Pydantic models.
 *
 * Source: google-agentic-commerce/AP2/src/ap2/types/
 * These are TypeScript representations of AP2's canonical Python types.
 * Only the subset relevant to SweeFi integration is included.
 */

// ══════════════════════════════════════════════════════════════
// W3C Payment Request types (used by AP2)
// ══════════════════════════════════════════════════════════════

export interface AP2PaymentCurrencyAmount {
  /** Three-letter ISO 4217 currency code */
  currency: string;
  /** Monetary value */
  value: number;
}

export interface AP2PaymentItem {
  /** Human-readable description */
  label: string;
  /** Monetary amount */
  amount: AP2PaymentCurrencyAmount;
  /** If true, amount is not final */
  pending?: boolean;
  /** Refund duration in days (default: 30) */
  refund_period?: number;
}

export interface AP2PaymentMethodData {
  /** Payment method identifiers (e.g., "s402", "x402", "basic-card") */
  supported_methods: string[];
  /** Method-specific data */
  data?: Record<string, unknown>;
}

export interface AP2PaymentDetailsInit {
  /** Items to display */
  display_items: AP2PaymentItem[];
  /** Total payment amount */
  total: AP2PaymentItem;
}

export interface AP2PaymentRequest {
  /** Supported payment methods */
  method_data: AP2PaymentMethodData[];
  /** Financial details */
  details: AP2PaymentDetailsInit;
}

export interface AP2PaymentResponse {
  /** Unique ID from original PaymentRequest */
  request_id: string;
  /** Payment method chosen by user */
  method_name: string;
  /** Method-specific details */
  details?: Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════
// AP2 Mandate types
// ══════════════════════════════════════════════════════════════

/**
 * AP2 IntentMandate — human-NOT-present pre-authorization.
 *
 * 6 fields. ZERO financial/budget fields.
 * Only `intent_expiry` maps to SweeFi (→ expiresAtMs).
 */
export interface AP2IntentMandate {
  /**
   * If false, agent can purchase without user confirmation once conditions met.
   * Must be true if not signed by user.
   */
  user_cart_confirmation_required: boolean;
  /** NL description of user intent, confirmed by user */
  natural_language_description: string;
  /** Allowed merchants (null = any) */
  merchants?: string[] | null;
  /** Specific product SKUs (null = any) */
  skus?: string[] | null;
  /** If true, items must be refundable */
  requires_refundability?: boolean;
  /** When this mandate expires (ISO 8601) */
  intent_expiry: string;
}

/** Cart contents with items, amounts, and merchant info */
export interface AP2CartContents {
  /** Items in the cart */
  items: AP2PaymentItem[];
  /** Cart total */
  total: AP2PaymentItem;
  /** Cart expiry (ISO 8601) */
  cart_expiry: string;
  /** Merchant name */
  merchant_name: string;
}

/**
 * AP2 CartMandate — human-present, merchant-signed cart.
 *
 * Structurally stronger mapping to SweeFi Invoice:
 * amount, payer context, payee (merchant) all present.
 */
export interface AP2CartMandate {
  /** The cart contents */
  contents: AP2CartContents;
  /** JWT signing the cart (merchant's guarantee) */
  merchant_authorization?: string | null;
}

/**
 * AP2 PaymentMandate — bridges authorization to settlement.
 * Contains tokenized payment details and attestation.
 */
export interface AP2PaymentMandate {
  payment_mandate_contents: {
    payment_mandate_id: string;
    payment_details_id: string;
    payment_details_total: AP2PaymentItem;
    payment_response: AP2PaymentResponse;
    merchant_agent: string;
    timestamp: string;
  };
  user_authorization?: string | null;
}

// ══════════════════════════════════════════════════════════════
// AP2 Payment Receipt
// ══════════════════════════════════════════════════════════════

export interface AP2PaymentReceiptSuccess {
  /** Merchant confirmation ID */
  merchant_confirmation_id: string;
  /** Payment processor confirmation ID */
  psp_confirmation_id?: string | null;
  /** Network confirmation ID */
  network_confirmation_id?: string | null;
}

export interface AP2PaymentReceiptError {
  /** Human-readable error message */
  error_message: string;
}

export interface AP2PaymentReceipt {
  /** Unique receipt ID */
  receipt_id: string;
  /** Transaction status */
  status: 'success' | 'error' | 'pending';
  /** Success details (if status = success) */
  success?: AP2PaymentReceiptSuccess;
  /** Error details (if status = error) */
  error?: AP2PaymentReceiptError;
  /** ISO 8601 timestamp */
  timestamp: string;
}

// ══════════════════════════════════════════════════════════════
// SweeFi-side config types (caller provides these)
// ══════════════════════════════════════════════════════════════

/** Config for IntentMandate → AgentMandate factory (caller provides 8 of 9 fields) */
export interface MandateDefaults {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Human (delegator) Sui address */
  delegator: string;
  /** Agent (delegate) Sui address */
  delegate: string;
  /** Per-transaction spending cap (MIST) */
  maxPerTx: string;
  /** Daily spending limit (MIST) */
  dailyLimit: string;
  /** Weekly spending limit (MIST) */
  weeklyLimit: string;
  /** Lifetime spending cap (MIST) */
  maxTotal: string;
  /** Authorization level: 0=READ_ONLY, 1=MONITOR, 2=CAPPED, 3=AUTONOMOUS */
  level: 0 | 1 | 2 | 3;
}

/** Config for CartMandate → Invoice factory */
export interface InvoiceDefaults {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Payer Sui address */
  payer: string;
  /** Payee Sui address */
  payee: string;
  /** Exchange rate: 1 USD = X base units (e.g., 1 USD = 1_000_000 USDC-6) */
  usdToBaseUnits: bigint;
  /** Facilitator fee in micro-percent (0-1000000, where 1000000 = 100%) */
  feeMicroPercent: number;
  /** Address that receives the facilitator fee */
  feeRecipient: string;
}
