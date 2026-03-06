/**
 * @module @sweefi/sui — Sui-native payment protocol implementation
 *
 * Provides the Sui-specific implementation of the s402 payment protocol.
 * Implements the sign-first model using Sui's PTBs and sub-second finality.
 */

// Export signer utilities and types
export { toClientSuiSigner, toFacilitatorSuiSigner } from "./signer";
export type { ClientSuiSigner, FacilitatorSuiSigner, FacilitatorSuiSignerConfig } from "./signer";

/**
 * Convenience alias for toClientSuiSigner.
 * Adapts any Sui keypair into a ClientSuiSigner for s402 payments.
 * Moved here from @sweefi/server/client to break circular dependency.
 */
export { toClientSuiSigner as adaptWallet } from "./signer";

// Export constants
export * from "./constants";

// Export utilities
export * from "./utils";

// s402 scheme implementations
export * from "./s402/index";

// Sui s402 client (high-level: registers schemes + wraps fetch)
export { createS402Client } from "./client/s402-client";
export type { s402ClientConfig, SuiNetwork } from "./client/s402-types";

// PaymentAdapter implementation for @sweefi/ui-core
export { SuiPaymentAdapter } from "./adapter/SuiPaymentAdapter";
export type { SuiPaymentAdapterConfig } from "./adapter/SuiPaymentAdapter";

// Receipt HTTP helpers (v0.2 signed usage receipts)
export { signUsageReceipt, parseUsageReceipt, ReceiptAccumulator, S402_RECEIPT_HEADER } from "./receipt-http";
export type { VerifiedReceipt, ParsedReceipt } from "./receipt-http";
