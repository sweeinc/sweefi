import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import type { SuiNetwork } from '../types/network.js';

/**
 * Create a Sui JSON-RPC client for the specified network.
 *
 * @mysten/sui 2.x moved the JSON-RPC client to `@mysten/sui/jsonRpc`.
 * The `network` field is now required on the constructor.
 */
export function createSuiClient(network: SuiNetwork): SuiJsonRpcClient {
  const url = getJsonRpcFullnodeUrl(network);
  return new SuiJsonRpcClient({ url, network });
}

export type { SuiJsonRpcClient };
