import type { Signer } from "@mysten/sui/cryptography";
import type { SuiClient } from "@mysten/sui/client";
import { toClientSuiSigner } from "@sweepay/sui";
import type { ClientSuiSigner } from "@sweepay/sui";

/**
 * Adapt any Sui keypair into a ClientSuiSigner for x402 payments.
 *
 * Works with Ed25519Keypair, Secp256k1Keypair, and any object
 * implementing the @mysten/sui Signer interface.
 *
 * @param wallet - Sui keypair
 * @param client - SuiClient for transaction building
 * @returns ClientSuiSigner compatible with x402
 */
export function adaptWallet(wallet: Signer, client: SuiClient): ClientSuiSigner {
  return toClientSuiSigner(wallet, client);
}
