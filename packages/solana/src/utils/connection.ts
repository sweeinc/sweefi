/**
 * Solana connection helpers — network config and cluster URL resolution.
 */

import { Connection, clusterApiUrl } from '@solana/web3.js';
import { USDC_MAINNET_MINT, USDC_DEVNET_MINT, SOLANA_MAINNET_CAIP2 } from '../constants.js';
import type { SolanaNetwork } from '../constants.js';

// ─── Cluster name mapping ─────────────────────────────────────────────────────

/** Maps a CAIP-2 network identifier to a Solana cluster name. */
export function networkToCluster(
  network: SolanaNetwork,
): 'mainnet-beta' | 'devnet' | 'testnet' {
  switch (network) {
    case 'solana:mainnet-beta':
      return 'mainnet-beta';
    case 'solana:devnet':
      return 'devnet';
    case 'solana:testnet':
      return 'testnet';
    default: {
      const _exhaustive: never = network;
      throw new Error(`Unknown Solana network: ${_exhaustive as string}`);
    }
  }
}

// ─── Connection factory ───────────────────────────────────────────────────────

/**
 * Create a Solana Connection for a given CAIP-2 network.
 *
 * @param network - CAIP-2 network identifier (e.g. 'solana:devnet')
 * @param rpcUrl  - Optional custom RPC URL; falls back to public cluster endpoint
 * @returns A Connection committed to 'confirmed' finality
 */
export function createSolanaConnection(network: SolanaNetwork, rpcUrl?: string): Connection {
  const url = rpcUrl ?? clusterApiUrl(networkToCluster(network));
  return new Connection(url, 'confirmed');
}

/**
 * Returns the default USDC mint address for a given network.
 * constants.ts has zero imports, so importing from it here is safe — no circular dep.
 */
export function getDefaultUsdcMint(network: string): string {
  return network === SOLANA_MAINNET_CAIP2 ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;
}
