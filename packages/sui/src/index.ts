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
