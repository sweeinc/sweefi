import type { SealKeyServerConfig, SuiNetwork } from '../types/network.js';
import { NETWORKS } from '../types/network.js';

/**
 * Retrieve SEAL key server configs for a given network.
 * Encapsulates key server discovery so consumers never hardcode object IDs.
 */
export function getSealKeyServers(network: SuiNetwork): SealKeyServerConfig[] {
  return NETWORKS[network].sealKeyServers;
}

/**
 * Compute the threshold needed for SEAL operations on a given network.
 * Default threshold: majority of configured key servers.
 */
export function getSealThreshold(network: SuiNetwork): number {
  const servers = getSealKeyServers(network);
  if (servers.length === 0) return 0;
  return Math.ceil(servers.length / 2);
}
