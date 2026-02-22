/**
 * Configuration types for the Sui s402 client.
 */

export type SuiNetwork = "sui:testnet" | "sui:mainnet" | "sui:devnet";

export interface s402ClientConfig {
  /** Sui keypair (Ed25519Keypair, Secp256k1Keypair, etc.) */
  wallet: import("@mysten/sui/cryptography").Signer;

  /** Target Sui network (e.g., "sui:testnet") */
  network: SuiNetwork;

  /** Custom RPC URL (optional) */
  rpcUrl?: string;

  /** Custom facilitator URL (optional) */
  facilitatorUrl?: string;

  /**
   * SweeFi package ID on Sui.
   * Required for stream, escrow, and seal schemes.
   * If omitted, only exact payments are supported.
   */
  packageId?: string;
}
