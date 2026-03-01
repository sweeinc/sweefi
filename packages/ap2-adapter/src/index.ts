/**
 * @sweefi/ap2-adapter — AP2 (Agent Payments Protocol) ↔ SweeFi bridge.
 *
 * Translates Google's AP2 mandate types to SweeFi on-chain primitives:
 *   - IntentMandate → AgentMandate (thin: only TTL maps)
 *   - CartMandate → Invoice (strong: amount, merchant, expiry map)
 *   - Sui tx digest → AP2 PaymentReceipt (outbound)
 *   - s402 scheme list → AP2 PaymentMethodData (discovery)
 *
 * Three layers (use the level you need):
 *   1. types.ts  — TypeScript types (zero runtime)
 *   2. mapper.ts — Pure data transformations (lightweight)
 *   3. bridge.ts — End-to-end: validate → map → build PTB (needs @sweefi/sui)
 */

// ── Types (AP2 + SweeFi config) ──────────────────────────────
export type {
  AP2PaymentCurrencyAmount,
  AP2PaymentItem,
  AP2PaymentMethodData,
  AP2PaymentDetailsInit,
  AP2PaymentRequest,
  AP2PaymentResponse,
  AP2IntentMandate,
  AP2CartContents,
  AP2CartMandate,
  AP2PaymentMandate,
  AP2PaymentReceiptSuccess,
  AP2PaymentReceiptError,
  AP2PaymentReceipt,
  MandateDefaults,
  InvoiceDefaults,
} from './types';

// ── Mapper output types ──────────────────────────────────────
export type { AgentMandateParams, InvoiceParams } from './mapper';

// ── Zod validation schemas ───────────────────────────────────
export {
  intentMandateSchema,
  cartContentsSchema,
  cartMandateSchema,
  paymentMethodDataSchema,
  mandateDefaultsSchema,
  invoiceDefaultsSchema,
} from './schemas';

// ── Pure mappers (no PTB dependency) ─────────────────────────
export {
  createAgentMandateFromAP2Intent,
  createInvoiceFromAP2Cart,
  toAP2PaymentReceipt,
  toAP2PaymentReceiptError,
  toAP2PaymentMethodData,
} from './mapper';

// ── Bridge (validate → map → build PTB) ─────────────────────
export {
  buildAgentMandateFromIntent,
  buildInvoiceFromCart,
} from './bridge';
