/**
 * AP2 → SweeFi mapping functions.
 *
 * Two mappings, two asymmetries:
 *
 * CartMandate → Invoice (STRONG)
 *   AP2 provides: amount, currency, merchant, expiry.
 *   Caller provides: Sui addresses, exchange rate, fees.
 *
 * IntentMandate → AgentMandate (THIN)
 *   AP2 provides: only TTL (intent_expiry).
 *   Caller provides: all 8 spending parameters.
 *
 * Plus outbound helpers: Sui tx digest → AP2 PaymentReceipt,
 * and s402 scheme discovery → AP2 PaymentMethodData.
 */

import type {
  AP2IntentMandate,
  AP2CartMandate,
  AP2PaymentReceipt,
  AP2PaymentMethodData,
  MandateDefaults,
  InvoiceDefaults,
} from './types';

// Re-use the SweeFi param types directly (no wrapper)
// These match @sweefi/sui's CreateAgentMandateParams and CreateInvoiceParams.

/** Output of IntentMandate mapping — matches CreateAgentMandateParams */
export interface AgentMandateParams {
  coinType: string;
  sender: string;
  delegate: string;
  level: 0 | 1 | 2 | 3;
  maxPerTx: bigint;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  maxTotal: bigint;
  expiresAtMs: bigint;
}

/** Output of CartMandate mapping — matches CreateInvoiceParams */
export interface InvoiceParams {
  sender: string;
  recipient: string;
  expectedAmount: bigint;
  feeMicroPercent: number;
  feeRecipient: string;
  sendTo: string;
}

// ══════════════════════════════════════════════════════════════
// IntentMandate → AgentMandate (thin: only TTL maps)
// ══════════════════════════════════════════════════════════════

/**
 * Map an AP2 IntentMandate → SweeFi CreateAgentMandateParams.
 *
 * AP2 contributes 1 of 9 fields (intent_expiry → expiresAtMs).
 * Everything else comes from the caller's MandateDefaults — this is
 * by design, since AP2 IntentMandates carry zero financial data.
 */
export function createAgentMandateFromAP2Intent(
  intent: AP2IntentMandate,
  config: MandateDefaults,
): AgentMandateParams {
  const parsed = Date.parse(intent.intent_expiry);
  if (isNaN(parsed)) {
    throw new Error(`Invalid intent_expiry: ${intent.intent_expiry}`);
  }
  const expiresAtMs = BigInt(parsed);

  return {
    coinType: config.coinType,
    sender: config.delegator,
    delegate: config.delegate,
    level: config.level,
    maxPerTx: BigInt(config.maxPerTx),
    dailyLimit: BigInt(config.dailyLimit),
    weeklyLimit: BigInt(config.weeklyLimit),
    maxTotal: BigInt(config.maxTotal),
    expiresAtMs,
  };
}

// ══════════════════════════════════════════════════════════════
// Fiat → base unit conversion (float-free)
// ══════════════════════════════════════════════════════════════

/**
 * Convert a fiat value (e.g. 279.99) to on-chain base units using
 * pure bigint math. Avoids IEEE 754 precision loss that occurs when
 * multiplying floats by large conversion factors.
 *
 * Strategy: parse the float's string representation to extract an
 * integer numerator and power-of-10 denominator, then multiply in
 * bigint space.
 *
 * Example: fiatToBaseUnits(279.99, 1_000_000n) → 279_990_000n
 */
function fiatToBaseUnits(value: number, rate: bigint): bigint {
  const str = value.toString();
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) {
    // Whole number — no decimal part
    return BigInt(str) * rate;
  }
  const decimals = str.length - dotIndex - 1;
  const wholePart = str.slice(0, dotIndex);
  const fracPart = str.slice(dotIndex + 1);
  // e.g. "279.99" → numerator = 27999, scale = 100
  const numerator = BigInt(wholePart + fracPart);
  const scale = 10n ** BigInt(decimals);
  return (numerator * rate) / scale;
}

// ══════════════════════════════════════════════════════════════
// CartMandate → Invoice (strong: amount, merchant, expiry map)
// ══════════════════════════════════════════════════════════════

/**
 * Map an AP2 CartMandate → SweeFi CreateInvoiceParams.
 *
 * Structurally strong mapping:
 *  - cart total × exchange rate → expectedAmount
 *  - config.payee → recipient (merchant)
 *  - config.payer → sendTo (invoice sent to payer for payment)
 *
 * Currently only supports USD carts. Throws on other currencies.
 */
export function createInvoiceFromAP2Cart(
  cart: AP2CartMandate,
  config: InvoiceDefaults,
): InvoiceParams {
  const { total } = cart.contents;
  const { currency, value } = total.amount;

  if (currency !== 'USD') {
    throw new Error(
      `Unsupported currency: ${currency}. Only USD is currently supported.`,
    );
  }

  if (value <= 0) {
    throw new Error(`Cart total must be positive, got ${value}`);
  }

  // Convert fiat → on-chain base units using string-based parsing
  // to avoid IEEE 754 float precision loss on large amounts.
  // Example: $10.50 × 1_000_000 (USDC-6) = 10_500_000 base units.
  const expectedAmount = fiatToBaseUnits(value, config.usdToBaseUnits);

  return {
    sender: config.payee,        // Payee creates the invoice
    recipient: config.payee,     // Payee receives payment
    expectedAmount,
    feeMicroPercent: config.feeMicroPercent,
    feeRecipient: config.feeRecipient,
    sendTo: config.payer,        // Invoice sent to payer
  };
}

// ══════════════════════════════════════════════════════════════
// Outbound: Sui → AP2 (receipt + discovery)
// ══════════════════════════════════════════════════════════════

/**
 * Create an AP2 PaymentReceipt from a Sui transaction digest.
 *
 * Maps Sui's on-chain finality to AP2's receipt model.
 * `network_confirmation_id` is the Sui tx digest — verifiable
 * by any Sui fullnode.
 */
export function toAP2PaymentReceipt(txDigest: string): AP2PaymentReceipt {
  return {
    receipt_id: txDigest, // Use digest as receipt ID (globally unique)
    status: 'success',
    success: {
      merchant_confirmation_id: txDigest,
      network_confirmation_id: txDigest,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an AP2 PaymentReceipt for a failed transaction.
 */
export function toAP2PaymentReceiptError(errorMessage: string): AP2PaymentReceipt {
  return {
    receipt_id: `error-${Date.now()}`,
    status: 'error',
    error: { error_message: errorMessage },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build AP2 PaymentMethodData advertising s402 on Sui.
 *
 * Used for AP2 discovery: tells buyer agents what payment methods
 * this facilitator supports. The `data` field carries s402-specific
 * metadata (network, supported schemes, transport options).
 *
 * @param schemes - s402 schemes this facilitator supports (default: all 5)
 */
export function toAP2PaymentMethodData(
  schemes?: string[],
): AP2PaymentMethodData {
  return {
    supported_methods: ['s402'],
    data: {
      network: 'sui',
      schemes: schemes ?? ['exact', 'stream', 'prepaid', 'escrow', 'unlock'],
      transport: ['header', 'body'],
    },
  };
}
