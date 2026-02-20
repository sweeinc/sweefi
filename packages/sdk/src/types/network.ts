export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export interface SealKeyServerConfig {
  objectId: string;
  weight: number;
}

export interface NetworkConfig {
  network: SuiNetwork;
  fullnodeUrl: string;
  sealKeyServers: SealKeyServerConfig[];
  walrusAggregatorUrl: string;
  walrusPublisherUrl: string;
}

/**
 * Pre-configured networks. Extensible for custom deployments.
 *
 * Key server object IDs and Walrus URLs will need updating as
 * the Sui ecosystem evolves. These are current as of Feb 2026.
 */
export const NETWORKS: Record<SuiNetwork, NetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    fullnodeUrl: 'https://fullnode.mainnet.sui.io:443',
    sealKeyServers: [], // TODO: populate when SEAL mainnet key servers are known
    walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
    walrusPublisherUrl: 'https://publisher.walrus-mainnet.walrus.space',
  },
  testnet: {
    network: 'testnet',
    fullnodeUrl: 'https://fullnode.testnet.sui.io:443',
    sealKeyServers: [
      // Source: MystenLabs/seal/examples/frontend/src/AllowlistView.tsx (official SEAL example)
      { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
      { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
    ],
    walrusAggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    walrusPublisherUrl: 'https://publisher.walrus-testnet.walrus.space',
  },
  devnet: {
    network: 'devnet',
    fullnodeUrl: 'https://fullnode.devnet.sui.io:443',
    sealKeyServers: [],
    walrusAggregatorUrl: '',
    walrusPublisherUrl: '',
  },
  localnet: {
    network: 'localnet',
    fullnodeUrl: 'http://127.0.0.1:9000',
    sealKeyServers: [],
    walrusAggregatorUrl: '',
    walrusPublisherUrl: '',
  },
};
