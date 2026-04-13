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
 * Moved here from @sweefi/hono/client to break circular dependency.
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
export type {
  s402ClientConfig,
  SuiNetwork,
  S402FetchInit,
  S402FetchRequestOptions,
  S402PaymentMetadata,
} from "./client/s402-types";

// PaymentAdapter implementation for @sweefi/ui-core
export { SuiPaymentAdapter } from "./adapter/SuiPaymentAdapter";
export type { SuiPaymentAdapterConfig } from "./adapter/SuiPaymentAdapter";

// Receipt HTTP helpers (v0.2 signed usage receipts)
export { signUsageReceipt, parseUsageReceipt, ReceiptAccumulator, S402_RECEIPT_HEADER } from "./receipt-http";
export type { VerifiedReceipt, ParsedReceipt } from "./receipt-http";

// $extend() plugin — the new primary entry point
export { sweefi, SweefiClient } from "./extend";
export type { SweefiOptions, SweefiPublicAPI, SweefiCompatibleClient } from "./extend";

// $extend() transaction builder contracts (for advanced use / testing)
export { PaymentContract } from "./transactions/payment";
export { StreamContract } from "./transactions/stream";
export { EscrowContract } from "./transactions/escrow";
export { PrepaidContract } from "./transactions/prepaid";
export { UptoContract } from "./transactions/upto";
export { UNLIMITED_CALLS } from "./ptb/prepaid";
export { MandateContract } from "./transactions/mandate";
export { AgentMandateContract } from "./transactions/agentMandate";
export { AdminContract } from "./transactions/admin";
export { SweefiPluginConfig, createBuilderConfig } from "./utils/config";
export type { CoinConfig, TransactionBuilderConfig } from "./utils/config";
export { SweefiError, ConfigurationError, ResourceNotFoundError, ValidationError, SweefiErrorCode } from "./utils/errors";

// BCS type definitions for on-chain object parsing
export {
  StreamingMeterBcs, EscrowBcs, PrepaidBalanceBcs, UptoDepositBcs,
  InvoiceBcs, MandateBcs, ProtocolStateBcs, AgentMandateBcs,
} from "./types/bcs";

// Query module types (for consumers who need to type query results)
export type { QueryContext } from "./queries/context";
export type { StreamState } from "./queries/streamQueries";
export type { EscrowData, EscrowStateValue } from "./queries/escrowQueries";
export { EscrowState } from "./queries/escrowQueries";
export type { PrepaidState } from "./queries/prepaidQueries";
export type { MandateState } from "./queries/mandateQueries";
export type { ProtocolStateData } from "./queries/protocolQueries";
export type { UptoDepositData } from "./queries/uptoQueries";
export { UptoDepositState } from "./queries/uptoQueries";
