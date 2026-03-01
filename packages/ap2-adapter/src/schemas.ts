/**
 * Zod validation schemas for AP2 JSON payloads.
 *
 * These validate incoming AP2 data at the trust boundary before
 * mapping to SweeFi types. Pattern borrowed from @sweefi/mcp.
 */

import { z } from 'zod';

// ══════════════════════════════════════════════════════════════
// Shared primitives
// ══════════════════════════════════════════════════════════════

const iso8601 = z.string().refine(
  (s) => !isNaN(Date.parse(s)),
  { message: 'Must be a valid ISO 8601 date string' },
);

const paymentCurrencyAmount = z.object({
  currency: z.string().min(3).max(3).describe('ISO 4217 currency code'),
  value: z.number().describe('Monetary value'),
});

const paymentItem = z.object({
  label: z.string().describe('Human-readable item description'),
  amount: paymentCurrencyAmount,
  pending: z.boolean().optional(),
  refund_period: z.number().int().nonnegative().optional(),
});

// ══════════════════════════════════════════════════════════════
// AP2 Mandate schemas
// ══════════════════════════════════════════════════════════════

/** Validates AP2 IntentMandate JSON */
export const intentMandateSchema = z.object({
  user_cart_confirmation_required: z.boolean(),
  natural_language_description: z.string().min(1),
  merchants: z.array(z.string()).nullable().optional(),
  skus: z.array(z.string()).nullable().optional(),
  requires_refundability: z.boolean().optional(),
  intent_expiry: iso8601,
});

/** Validates AP2 CartContents JSON */
export const cartContentsSchema = z.object({
  items: z.array(paymentItem).min(1),
  total: paymentItem,
  cart_expiry: iso8601,
  merchant_name: z.string().min(1),
});

/** Validates AP2 CartMandate JSON */
export const cartMandateSchema = z.object({
  contents: cartContentsSchema,
  merchant_authorization: z.string().nullable().optional(),
});

/** Validates AP2 PaymentMethodData */
export const paymentMethodDataSchema = z.object({
  supported_methods: z.array(z.string()).min(1),
  data: z.record(z.unknown()).optional(),
});

// ══════════════════════════════════════════════════════════════
// Config schemas (SweeFi-side defaults)
// ══════════════════════════════════════════════════════════════

const suiAddress = z.string().regex(
  /^0x[0-9a-fA-F]{64}$/,
  'Must be a 32-byte Sui address (0x + 64 hex chars)',
);

const mistAmount = z.string().regex(
  /^(0|[1-9][0-9]*)$/,
  'Must be a non-negative integer string (MIST)',
);

/** Validates MandateDefaults config */
export const mandateDefaultsSchema = z.object({
  coinType: z.string().min(1),
  delegator: suiAddress,
  delegate: suiAddress,
  maxPerTx: mistAmount,
  dailyLimit: mistAmount,
  weeklyLimit: mistAmount,
  maxTotal: mistAmount,
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

/** Validates InvoiceDefaults config */
export const invoiceDefaultsSchema = z.object({
  coinType: z.string().min(1),
  payer: suiAddress,
  payee: suiAddress,
  usdToBaseUnits: z.bigint().positive(),
  feeMicroPercent: z.number().int().min(0).max(1_000_000),
  feeRecipient: suiAddress,
});
