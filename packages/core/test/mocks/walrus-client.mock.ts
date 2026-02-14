import { vi } from 'vitest';

/**
 * Mock WalrusClient for unit testing.
 * Based on external/ts-sdks-fork/packages/walrus/src/client.ts
 *
 * Use this mock in any project that needs Walrus blob storage tests
 * without hitting real aggregator/publisher nodes.
 */
export function createMockWalrusClient() {
  return {
    writeBlob: vi.fn().mockResolvedValue({
      blobId: 'mock_blob_id_' + Math.random().toString(36).slice(2, 10),
      endEpoch: 100,
      suiObjectId: '0xmock_blob_object',
    }),
    readBlob: vi.fn().mockImplementation(async (_blobId: string) => {
      return new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    }),
    getBlobInfo: vi.fn().mockResolvedValue({
      blobId: 'mock_blob_id',
      size: 5,
      endEpoch: 100,
    }),
  };
}
