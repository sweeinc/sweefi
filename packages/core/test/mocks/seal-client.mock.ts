import { vi } from 'vitest';

/**
 * Mock SealClient for unit testing.
 * Based on actual API from external/ts-sdks-fork/packages/seal/src/client.ts
 *
 * Use this mock in any project that needs SEAL encryption tests
 * without hitting real key servers.
 */
export function createMockSealClient() {
  return {
    encrypt: vi.fn().mockResolvedValue({
      encryptedObject: new Uint8Array([1, 2, 3, 4]),
      key: new Uint8Array(32).fill(0xab),
    }),
    decrypt: vi.fn().mockImplementation(async (_encrypted: Uint8Array) => {
      return new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    }),
    fetchKeys: vi.fn().mockResolvedValue([
      { serverId: '0x1111', key: new Uint8Array(32) },
      { serverId: '0x2222', key: new Uint8Array(32) },
    ]),
  };
}

/**
 * Mock SessionKey for testing session-based decryption.
 * Based on external/ts-sdks-fork/packages/seal/src/session-key.ts
 */
export function createMockSessionKey() {
  return {
    getAddress: vi.fn().mockReturnValue('0xmock_session_address'),
    isExpired: vi.fn().mockReturnValue(false),
    export: vi.fn().mockReturnValue(new Uint8Array(64)),
  };
}
