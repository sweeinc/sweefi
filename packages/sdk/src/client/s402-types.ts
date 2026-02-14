/**
 * s402 SDK Client types
 */

import type { SuiNetwork } from '../shared/types.js';

export interface s402ClientConfig {
  /** Sui keypair (Ed25519Keypair, Secp256k1Keypair, etc.) */
  wallet: import('@mysten/sui/cryptography').Signer;

  /** Target Sui network (e.g., "sui:testnet") */
  network: SuiNetwork;

  /** Custom RPC URL (optional) */
  rpcUrl?: string;

  /** Custom facilitator URL (optional) */
  facilitatorUrl?: string;

  /**
   * SweePay package ID on Sui.
   * Required for stream, escrow, and seal schemes.
   * If omitted, only exact payments are supported.
   */
  packageId?: string;
}
