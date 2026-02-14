import { KeyStore } from '@mysten/seal';
import { getAllowlistedKeyServers, retrieveKeyServers } from '@mysten/seal';
import type { KeyServer } from '@mysten/seal';
import type { SuiNetwork } from '../types/network.js';

/**
 * Configured SEAL client bundle.
 *
 * The @mysten/seal SDK has no single "SealClient" class — it exposes
 * KeyStore, SessionKey, encrypt(), and key server utilities separately.
 * This bundle provides a pre-configured KeyStore with resolved key servers
 * so consumers don't need to manage SEAL setup themselves.
 */
export interface SweeSealClient {
  keyStore: KeyStore;
  keyServers: KeyServer[];
  threshold: number;
  network: SuiNetwork;
}

export interface CreateSealClientOptions {
  /** Whether to verify key server proofs of possession (slower, more secure). Default: false */
  verifyKeyServers?: boolean;
}

type SealCompatibleClient = Parameters<typeof retrieveKeyServers>[0]['client'];

/**
 * Create a SEAL client bundle with network-appropriate key server configuration.
 * Encapsulates key server discovery so consumers never hardcode object IDs.
 *
 * NOTE: SEAL key servers are only available on testnet and mainnet.
 * On devnet/localnet, returns an empty key server list.
 */
export async function createSealClient(
  suiClient: SealCompatibleClient,
  network: SuiNetwork,
  _options?: CreateSealClientOptions,
): Promise<SweeSealClient> {
  const keyStore = new KeyStore();

  // SEAL only supports testnet and mainnet
  if (network !== 'testnet' && network !== 'mainnet') {
    return { keyStore, keyServers: [], threshold: 0, network };
  }

  const objectIds = getAllowlistedKeyServers(network);
  const keyServers = await retrieveKeyServers({ objectIds, client: suiClient });
  const threshold = Math.ceil(keyServers.length / 2);

  return { keyStore, keyServers, threshold, network };
}
