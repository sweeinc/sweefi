import { vi } from 'vitest';

/**
 * Mock SuiClient for unit testing.
 * Based on @mysten/sui SuiClient API.
 *
 * Use this mock in any project that needs Sui RPC tests
 * without hitting real fullnodes.
 */
export function createMockSuiClient() {
  return {
    getBalance: vi.fn().mockResolvedValue({
      coinType: '0x2::sui::SUI',
      totalBalance: '1000000000', // 1 SUI in MIST
      coinObjectCount: 1,
    }),
    getCoins: vi.fn().mockResolvedValue({
      data: [
        {
          coinType: '0x2::sui::SUI',
          coinObjectId: '0xmock_coin_001',
          balance: '1000000000',
          version: '1',
          digest: 'mock_digest_001',
        },
      ],
      hasNextPage: false,
    }),
    getAllBalances: vi.fn().mockResolvedValue([
      {
        coinType: '0x2::sui::SUI',
        totalBalance: '1000000000',
        coinObjectCount: 1,
      },
    ]),
    getOwnedObjects: vi.fn().mockResolvedValue({
      data: [],
      hasNextPage: false,
    }),
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      digest: '0xmock_tx_digest_abc123',
      effects: { status: { status: 'success' } },
    }),
    dryRunTransactionBlock: vi.fn().mockResolvedValue({
      effects: {
        status: { status: 'success' },
        gasUsed: {
          computationCost: '1000',
          storageCost: '500',
          storageRebate: '200',
        },
      },
    }),
    getTransactionBlock: vi.fn().mockResolvedValue({
      digest: '0xmock_tx_digest_abc123',
      transaction: { data: {} },
      effects: { status: { status: 'success' } },
    }),
    waitForTransaction: vi.fn().mockResolvedValue({
      digest: '0xmock_tx_digest_abc123',
    }),
  };
}
