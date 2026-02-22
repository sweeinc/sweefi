/**
 * s402 Solana Scheme Implementations
 *
 * Currently implemented: Exact only (SPL token + native SOL direct transfer).
 *
 * Future schemes require Anchor programs that don't yet exist for Solana:
 *   - Prepaid: PDA balance account (TODO — Anchor program needed)
 *   - Stream:  PDA meter + Clock sysvar (TODO — Anchor program needed)
 *   - Escrow:  PDA-held escrow account (TODO — Anchor program needed)
 *   - Unlock:  Lit Protocol or custom key server (TODO)
 */

// Exact
export { ExactSolanaClientScheme } from './exact/client.js';
export { ExactSolanaFacilitatorScheme } from './exact/facilitator.js';
export { ExactSolanaServerScheme } from './exact/server.js';
