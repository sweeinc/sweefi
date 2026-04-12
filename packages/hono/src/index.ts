/**
 * @module @sweefi/hono
 *
 * Chain-agnostic s402 server middleware and client fetch wrapper.
 *
 * Quick start (server):
 *   import { s402Gate } from '@sweefi/hono';
 *
 * Quick start (client / agent):
 *   import { wrapFetchWithS402 } from '@sweefi/hono/client';
 *
 * Subpath exports:
 *   @sweefi/hono         — server middleware + fetch wrapper (no Sui deps)
 *   @sweefi/hono/client  — fetch wrapper only (no blockchain deps)
 *   @sweefi/hono/server  — Hono middleware only (Node.js / edge)
 */

// Server-side Hono middleware
export { s402Gate } from "./server/index";
export type { s402GateConfig } from "./server/index";

// Client-side fetch wrapper (browser / agent)
// NOTE: adaptWallet was moved to @sweefi/sui to break a circular dependency.
// Import it from '@sweefi/sui' instead. See pre-publication audit.
export { wrapFetchWithS402, s402PaymentSentError } from "./client/s402-fetch";
export type { s402FetchOptions } from "./client/s402-fetch";

// Shared utilities
export { DEFAULT_FACILITATOR_URL } from "./shared/constants";

// Logger interface (lets consumers plug in Pino / Winston)
export type { SweeLogger } from "./logging/logger";
export { defaultLogger } from "./logging/logger";
