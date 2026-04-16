/**
 * SweeFi Solana Programs — TypeScript clients for Anchor programs
 *
 * These modules provide PDA derivation, account types, and instruction builders
 * for the 4 SweeFi Anchor programs on Solana.
 *
 * Program Status:
 *   - Anchor contracts: Compiles with `cargo check` ✓
 *   - Anchor build: Blocked by toolchain version (Anchor CLI 0.30.1 + edition2024 crates)
 *   - TypeScript: Full instruction builders, pending IDL for account deserialization
 *
 * Note: Namespaced exports to avoid conflicts (all programs export MIN_DEPOSIT, etc.)
 */

export * as upto from './upto.js';
export * as stream from './stream.js';
export * as escrow from './escrow.js';
export * as prepaid from './prepaid.js';
