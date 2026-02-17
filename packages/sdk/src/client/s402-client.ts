/**
 * s402 SDK Client — drop-in replacement for createPayingClient()
 *
 * Single client instance registers all Sui schemes (exact, stream, escrow, unlock).
 * Handles s402 402 responses and payment transparently.
 *
 * @example
 * ```typescript
 * import { createS402Client } from '@sweepay/sdk/client';
 * import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
 *
 * const wallet = Ed25519Keypair.generate();
 * const client = createS402Client({ wallet, network: 'sui:testnet' });
 *
 * const response = await client.fetch('https://api.example.com/premium/data');
 * ```
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { s402Client } from 's402';
import {
  ExactSuiClientScheme,
  PrepaidSuiClientScheme,
  StreamSuiClientScheme,
  EscrowSuiClientScheme,
  UnlockSuiClientScheme,
  DirectSuiSettlement,
} from '@sweepay/sui';
import { adaptWallet } from './wallet-adapter.js';
import { wrapFetchWithS402 } from './s402-fetch.js';
import { DEFAULT_FACILITATOR_URL } from '../shared/constants.js';
import type { s402ClientConfig } from './s402-types.js';

export function createS402Client(config: s402ClientConfig) {
  const { wallet, network, rpcUrl, facilitatorUrl, packageId } = config;

  // Create Sui JSON-RPC client (2.x: requires network param)
  const suiNetwork = network.replace('sui:', '') as 'testnet' | 'mainnet' | 'devnet';
  const suiClient = rpcUrl
    ? new SuiJsonRpcClient({ url: rpcUrl, network: suiNetwork })
    : new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(suiNetwork), network: suiNetwork });

  // Adapt wallet to s402 signer
  const signer = adaptWallet(wallet, suiClient);

  // Create s402 client with all Sui schemes registered
  const client = new s402Client();

  // Always register exact (base scheme)
  client.register(network, new ExactSuiClientScheme(signer));

  // Register advanced schemes if packageId is provided (needed for PTB builders)
  if (packageId) {
    const sweepayConfig = { packageId };
    client.register(network, new PrepaidSuiClientScheme(signer, sweepayConfig));
    client.register(network, new StreamSuiClientScheme(signer, sweepayConfig));
    client.register(network, new EscrowSuiClientScheme(signer, sweepayConfig));
    client.register(network, new UnlockSuiClientScheme(signer, sweepayConfig));
  }

  // Wrap fetch with s402 payment handling
  const paidFetch = wrapFetchWithS402(globalThis.fetch, client, {
    facilitatorUrl: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
  });

  // Direct settlement (no facilitator)
  const directSettlement = new DirectSuiSettlement(wallet, suiClient);

  return {
    /** Fetch with automatic s402 payment handling */
    fetch: paidFetch,

    /** The Sui address of the paying wallet */
    address: signer.address,

    /** The configured network */
    network,

    /** The underlying s402Client (for advanced usage) */
    s402Client: client,

    /** Direct settlement (bypasses facilitator) */
    directSettlement,

    /** The facilitator URL */
    facilitatorUrl: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
  };
}
