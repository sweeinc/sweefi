/**
 * @module @sweefi/server
 *
 * Chain-agnostic s402 server middleware and client fetch wrapper.
 *
 * Quick start (server):
 *   import { s402Gate } from '@sweefi/server';
 *
 * Quick start (client / agent):
 *   import { wrapFetchWithS402 } from '@sweefi/server/client';
 *
 * Subpath exports:
 *   @sweefi/server         — re-exports everything below
 *   @sweefi/server/client  — fetch wrapper only (browser / agent safe)
 *   @sweefi/server/server  — Hono middleware only (Node.js / edge)
 */

// Server-side Hono middleware
export { s402Gate } from "./server/index";
export type { s402GateConfig } from "./server/index";

// Client-side fetch wrapper
export { wrapFetchWithS402, adaptWallet, s402PaymentSentError } from "./client/index";
export type { s402FetchOptions } from "./client/index";

// Shared utilities
export { DEFAULT_FACILITATOR_URL } from "./shared/constants";

// Logger interface (lets consumers plug in Pino / Winston)
export type { SweeLogger } from "./logging/logger";
export { defaultLogger } from "./logging/logger";
