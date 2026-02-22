import type { Signer } from "@mysten/sui/cryptography";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { toClientSuiSigner } from "@sweefi/sui";
import type { ClientSuiSigner } from "@sweefi/sui";

/**
 * Adapt any Sui keypair into a ClientSuiSigner for s402 payments.
 *
 * Works with Ed25519Keypair, Secp256k1Keypair, and any object
 * implementing the @mysten/sui Signer interface.
 *
 * @param wallet - Sui keypair
 * @param client - SuiClient for transaction building
 * @returns ClientSuiSigner compatible with s402
 */
export function adaptWallet(wallet: Signer, client: SuiJsonRpcClient): ClientSuiSigner {
  return toClientSuiSigner(wallet, client);
}
