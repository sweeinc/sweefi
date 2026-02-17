/**
 * @module @sweepay/sdk
 *
 * s402 payment middleware for AI agents on Sui.
 *
 * Quick start:
 *   import { createS402Client, s402Gate } from '@sweepay/sdk';
 *
 * Subpath exports also available:
 * - @sweepay/sdk/client — client-side only
 * - @sweepay/sdk/server — server-side only
 */

// Re-export primary API surface from root for convenience
export { createS402Client, wrapFetchWithS402, adaptWallet } from "./client/index";
export type { s402ClientConfig, s402FetchOptions } from "./client/index";
export { s402Gate } from "./server/index";
export type { s402GateConfig } from "./server/index";

// Shared types
export type { SuiNetwork, Price } from "./shared/types";
