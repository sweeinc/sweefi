import { SealClient } from '@mysten/seal';
import type { SealClientOptions, KeyServerConfig } from '@mysten/seal';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { SuiNetwork } from '../types/network.js';
import { NETWORKS } from '../types/network.js';

/**
 * Configured SEAL client bundle.
 *
 * @mysten/seal 1.0: SealClient is the unified interface — owns key server
 * discovery, caching, encrypt, decrypt, and fetchKeys. The old KeyStore and
 * standalone retrieveKeyServers/getAllowlistedKeyServers are removed.
 */
export interface SweeSealClient {
  client: SealClient;
  threshold: number;
  network: SuiNetwork;
}

export interface CreateSealClientOptions {
  /**
   * Whether to verify key server proofs of possession.
   * Default: true in seal@1.x (was false in 0.x).
   * Set false to skip the extra /v1/service network call on init.
   */
  verifyKeyServers?: boolean;
  /** Request timeout in milliseconds. Default: 10_000 */
  timeout?: number;
}

/**
 * Create a SEAL client bundle with network-appropriate key server configuration.
 *
 * Synchronous construction — SealClient lazy-loads key servers on first use.
 *
 * NOTE: SEAL key servers are only available on testnet and mainnet.
 * On devnet/localnet, returns null (SEAL not available).
 */
export function createSealClient(
  suiClient: SuiJsonRpcClient,
  network: SuiNetwork,
  options?: CreateSealClientOptions,
): SweeSealClient | null {
  const networkConfig = NETWORKS[network];
  if (!networkConfig?.sealKeyServers?.length) {
    return null; // SEAL not available on this network
  }

  const serverConfigs: KeyServerConfig[] = networkConfig.sealKeyServers.map((s) => ({
    objectId: s.objectId,
    weight: s.weight,
  }));

  const threshold = Math.ceil(serverConfigs.length / 2);

  // SealClient accepts SealCompatibleClient = ClientWithExtensions<{ core: CoreClient }>
  // SuiJsonRpcClient satisfies this since it has `core: JSONRpcCoreClient extends CoreClient`
  const client = new SealClient({
    suiClient: suiClient as unknown as SealClientOptions['suiClient'],
    serverConfigs,
    verifyKeyServers: options?.verifyKeyServers ?? true,
    timeout: options?.timeout,
  });

  return { client, threshold, network };
}
