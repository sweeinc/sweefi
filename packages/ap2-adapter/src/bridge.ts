/**
 * AP2 → SweeFi bridge — end-to-end convenience layer.
 *
 * Composes: Zod validation → mapper → PTB builder.
 *
 * Each function accepts raw AP2 JSON (unknown), validates it,
 * maps it to SweeFi params, and returns an unsigned Sui Transaction
 * ready for signing.
 *
 * For lower-level access, use mapper.ts directly.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SweefiConfig } from '@sweefi/sui/ptb';
import { AgentMandateContract, PaymentContract, createBuilderConfig } from '@sweefi/sui';

import { intentMandateSchema, cartMandateSchema } from './schemas';
import { createAgentMandateFromAP2Intent, createInvoiceFromAP2Cart } from './mapper';
import type { MandateDefaults, InvoiceDefaults } from './types';

// ══════════════════════════════════════════════════════════════
// IntentMandate → AgentMandate PTB
// ══════════════════════════════════════════════════════════════

/**
 * Validate an AP2 IntentMandate, map to SweeFi params, build a PTB.
 *
 * @param intentJson - Raw AP2 IntentMandate JSON (validated at runtime)
 * @param mandateDefaults - Caller-provided spending parameters (8 of 9 fields)
 * @param sweefiConfig - Deployed SweeFi contract addresses
 * @returns Unsigned Sui Transaction ready for signing
 * @throws ZodError if intentJson fails validation
 * @throws Error if intent_expiry is invalid
 */
export function buildAgentMandateFromIntent(
  intentJson: unknown,
  mandateDefaults: MandateDefaults,
  sweefiConfig: SweefiConfig,
): Transaction {
  // 1. Validate at trust boundary
  const intent = intentMandateSchema.parse(intentJson);

  // 2. Map AP2 → SweeFi params
  const params = createAgentMandateFromAP2Intent(intent, mandateDefaults);

  // 3. Build unsigned PTB
  const contract = new AgentMandateContract(createBuilderConfig({
    packageId: sweefiConfig.packageId,
    protocolState: sweefiConfig.protocolStateId,
  }));
  const tx = new Transaction();
  contract.create(params)(tx);
  return tx;
}

// ══════════════════════════════════════════════════════════════
// CartMandate → Invoice PTB
// ══════════════════════════════════════════════════════════════

/**
 * Validate an AP2 CartMandate, map to SweeFi params, build a PTB.
 *
 * @param cartJson - Raw AP2 CartMandate JSON (validated at runtime)
 * @param invoiceDefaults - Caller-provided Sui addresses and exchange rate
 * @param sweefiConfig - Deployed SweeFi contract addresses
 * @returns Unsigned Sui Transaction ready for signing
 * @throws ZodError if cartJson fails validation
 * @throws Error if currency is not USD or amount is non-positive
 */
export function buildInvoiceFromCart(
  cartJson: unknown,
  invoiceDefaults: InvoiceDefaults,
  sweefiConfig: SweefiConfig,
): Transaction {
  // 1. Validate at trust boundary
  const cart = cartMandateSchema.parse(cartJson);

  // 2. Map AP2 → SweeFi params
  const params = createInvoiceFromAP2Cart(cart, invoiceDefaults);

  // 3. Build unsigned PTB
  const contract = new PaymentContract(createBuilderConfig({
    packageId: sweefiConfig.packageId,
    protocolState: sweefiConfig.protocolStateId,
  }));
  const tx = new Transaction();
  contract.createInvoice(params)(tx);
  return tx;
}
