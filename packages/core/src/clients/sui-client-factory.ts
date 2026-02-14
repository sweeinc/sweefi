import { SuiClient } from '@mysten/sui/client';
import { getFullnodeUrl } from '@mysten/sui/client';
import type { SuiNetwork } from '../types/network.js';

/**
 * Create a Sui JSON-RPC client for the specified network.
 *
 * NOTE: The original SPEC called for SuiGrpcClient, but
 * SuiClient (JSON-RPC) is more widely compatible — SEAL's
 * `retrieveKeyServers` expects a SuiClient, not SuiGrpcClient.
 * We use SuiClient as the primary client type.
 */
export function createSuiClient(network: SuiNetwork): SuiClient {
  const url = getFullnodeUrl(network);
  return new SuiClient({ url });
}

export type { SuiClient };
