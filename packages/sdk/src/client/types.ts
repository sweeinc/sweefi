import type { SuiNetwork } from "../shared/types";

/**
 * Configuration for createPayingClient()
 */
export interface PayingClientConfig {
  /**
   * Sui keypair (Ed25519Keypair, Secp256k1Keypair, etc.)
   */
  wallet: import("@mysten/sui/cryptography").Signer;

  /**
   * Target Sui network
   */
  network: SuiNetwork;

  /**
   * Custom RPC URL (optional — defaults to public fullnode)
   */
  rpcUrl?: string;

  /**
   * Custom facilitator URL (optional — defaults to swee-facilitator.fly.dev)
   */
  facilitatorUrl?: string;
}
