/**
 * @module @sweepay/sdk
 *
 * x402 payment middleware for AI agents on Sui.
 *
 * Subpath exports:
 * - @sweepay/sdk/client — createPayingClient() for AI agents that pay
 * - @sweepay/sdk/server — paymentGate() for APIs that charge
 */

// Re-export types only from root — use subpath imports for implementations
export type { PayingClientConfig } from "./client/types";
export type { PaymentGateConfig } from "./server/types";
export type { SuiNetwork, Price } from "./shared/types";
