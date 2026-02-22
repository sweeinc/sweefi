/**
 * @sweefi/ui-core — PaymentAdapter interface
 *
 * Chain-agnostic contract that every blockchain adapter must implement.
 * The adapter does NOT manage wallet lifecycle — it accepts an already-connected
 * signer injected at construction time (WalletClient for browsers,
 * Ed25519Keypair for headless Node.js agents).
 *
 * Dependency direction: @sweefi/sui → @sweefi/ui-core (never the reverse).
 */

import type { s402PaymentRequirements } from "s402";

// ─── SimulationResult ────────────────────────────────────────────────────────

/**
 * Result of a payment dry-run.
 * Both success and failure paths are typed — callers should never need to
 * parse string errors to distinguish cases.
 */
export interface SimulationResult {
  /** Whether the transaction would succeed on-chain. */
  success: boolean;
  /** Projected fee in the chain's native asset. Present when success = true. */
  estimatedFee?: { amount: bigint; currency: string };
  /** Typed error when success = false. */
  error?: { code: string; message: string };
}

// ─── PaymentAdapter ──────────────────────────────────────────────────────────

/**
 * The core contract every chain adapter must fulfill.
 *
 * Key design decisions:
 * - `simulate` takes only `reqs` — the adapter builds the draft transaction
 *   internally from requirements. This keeps the interface honest: callers
 *   don't need to know how transactions are constructed per chain.
 * - `signAndBroadcast` is atomic — the adapter signs and submits in one step.
 *   On Sui this is a single PTB; on Solana a single serialized transaction.
 * - Return type uses `txId` (chain-agnostic) not `txDigest` (Sui-specific) or
 *   `signature` (Solana-specific).
 */
export interface PaymentAdapter {
  /** Chain identifier, e.g. 'sui:mainnet', 'solana:mainnet-beta'. */
  network: string;

  /** Returns the connected/injected wallet address, or null if unavailable. */
  getAddress(): string | null;

  /**
   * Perform a dry-run against the chain without committing funds.
   * The adapter builds the transaction internally from `reqs`.
   */
  simulate(reqs: s402PaymentRequirements): Promise<SimulationResult>;

  /**
   * Sign and broadcast the payment transaction.
   * Called only after a successful `simulate()` and user confirmation.
   * Returns a chain-agnostic transaction identifier.
   */
  signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }>;
}
