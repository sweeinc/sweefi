/**
 * s402 Solana Scheme Implementations
 *
 * Implemented schemes (all 5):
 *   - Exact:   Direct SPL token + native SOL transfer (FULL)
 *   - Upto:    Variable-amount deposits with settlement ceiling (TypeScript ready)
 *   - Stream:  Per-second streaming micropayments (TypeScript ready)
 *   - Escrow:  Time-locked vault with arbiter resolution (TypeScript ready)
 *   - Prepaid: Agent deposit, provider claim (TypeScript ready)
 *
 * Status: All Anchor programs compile with `cargo check`. `anchor build` blocked by
 * toolchain version (Anchor CLI 0.30.1 bundles Cargo 1.75, crates require edition2024).
 * TypeScript instruction builders are complete. Facilitator settlement requires
 * account deserialization (pending Anchor IDL or manual borsh parsing).
 */

// Exact (FULL)
export { ExactSolanaClientScheme } from './exact/client.js';
export { ExactSolanaFacilitatorScheme } from './exact/facilitator.js';
export { ExactSolanaServerScheme } from './exact/server.js';

// Upto (TypeScript ready)
export { UptoSolanaClientScheme, UptoSolanaServerScheme, UptoSolanaFacilitatorScheme } from './upto/index.js';

// Stream (TypeScript ready)
export { StreamSolanaClientScheme, StreamSolanaServerScheme, StreamSolanaFacilitatorScheme } from './stream/index.js';

// Escrow (TypeScript ready)
export { EscrowSolanaClientScheme, EscrowSolanaServerScheme, EscrowSolanaFacilitatorScheme } from './escrow/index.js';

// Prepaid (TypeScript ready)
export { PrepaidSolanaClientScheme, PrepaidSolanaServerScheme, PrepaidSolanaFacilitatorScheme } from './prepaid/index.js';
