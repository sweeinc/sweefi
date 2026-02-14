import type { SuiNetwork } from '../types/network.js';

/** Walrus only supports mainnet and testnet */
export type WalrusNetwork = Extract<SuiNetwork, 'mainnet' | 'testnet'>;

/**
 * Create a Walrus client for the specified network.
 *
 * Uses dynamic import because @mysten/walrus@1.0.1 imports ClientCache from
 * @mysten/sui/client, but the installed @mysten/sui@1.45.2 only exports it
 * from @mysten/sui/experimental. Dynamic import defers this until runtime
 * so it doesn't break consumers who don't use Walrus.
 *
 * NOTE: SPEC originally called for `createWalrusClient(network)` but WalrusClient
 * requires a suiClient at construction. Updated signature accordingly.
 */
export async function createWalrusClient(
  network: WalrusNetwork,
  suiClient: unknown,
): Promise<InstanceType<Awaited<ReturnType<typeof importWalrus>>['WalrusClient']>> {
  const { WalrusClient } = await importWalrus();
  return new WalrusClient({ network, suiClient } as ConstructorParameters<typeof WalrusClient>[0]);
}

async function importWalrus() {
  return import('@mysten/walrus');
}
