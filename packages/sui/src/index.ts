/**
 * @module @sweefi/sui — Sui-native payment protocol implementation
 *
 * Provides the Sui-specific implementation of the s402 payment protocol.
 * Implements the sign-first model using Sui's PTBs and sub-second finality.
 */

// Export signer utilities and types
export { toClientSuiSigner, toFacilitatorSuiSigner } from "./signer";
export type { ClientSuiSigner, FacilitatorSuiSigner, FacilitatorSuiSignerConfig } from "./signer";

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
