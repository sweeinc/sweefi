import { describe, it, expect } from 'vitest';
import {
  createMessageEnvelope,
  NETWORKS,
  COIN_TYPES,
  COIN_DECIMALS,
  toSuiAddress,
  toObjectId,
  isValidSuiAddress,
} from '../src/index.js';
import type { MessageEnvelope, SuiNetwork, SuiAddress, ObjectId } from '../src/index.js';

describe('MessageEnvelope', () => {
  describe('when creating a message envelope', () => {
    it('should set version to 1 and auto-generate timestamp', () => {
      const before = Date.now();
      const envelope = createMessageEnvelope({
        type: 'text',
        sender: '0xabc',
        content: 'Hello world',
      });
      const after = Date.now();

      expect(envelope.version).toBe(1);
      expect(envelope.timestamp).toBeGreaterThanOrEqual(before);
      expect(envelope.timestamp).toBeLessThanOrEqual(after);
    });

    it('should preserve all required fields', () => {
      const envelope = createMessageEnvelope({
        type: 'task',
        sender: '0x123',
        content: 'Do something',
      });

      expect(envelope.type).toBe('task');
      expect(envelope.sender).toBe('0x123');
      expect(envelope.content).toBe('Do something');
    });

    it('should include optional fields when provided', () => {
      const envelope = createMessageEnvelope({
        type: 'approval_request',
        sender: '0xabc',
        content: 'Approve this',
        payload: { amount: 100 },
        attachmentBlobId: 'blob_123',
        replyTo: 'msg_456',
        correlationId: 'corr_789',
        ttl: 3600,
      });

      expect(envelope.payload).toEqual({ amount: 100 });
      expect(envelope.attachmentBlobId).toBe('blob_123');
      expect(envelope.replyTo).toBe('msg_456');
      expect(envelope.correlationId).toBe('corr_789');
      expect(envelope.ttl).toBe(3600);
    });

    it('should allow custom timestamp override', () => {
      const customTs = 1700000000000;
      const envelope = createMessageEnvelope({
        type: 'text',
        sender: '0xabc',
        content: 'Backdated',
        timestamp: customTs,
      });

      expect(envelope.timestamp).toBe(customTs);
    });

    it('should support all message types', () => {
      const types = ['text', 'task', 'approval_request', 'result', 'status', 'system', 'coordination'] as const;

      for (const type of types) {
        const envelope = createMessageEnvelope({
          type,
          sender: '0x1',
          content: `Type: ${type}`,
        });
        expect(envelope.type).toBe(type);
      }
    });
  });
});

describe('NetworkConfig', () => {
  describe('when accessing NETWORKS', () => {
    it('should have all four network configs', () => {
      const networks: SuiNetwork[] = ['mainnet', 'testnet', 'devnet', 'localnet'];
      for (const network of networks) {
        expect(NETWORKS[network]).toBeDefined();
        expect(NETWORKS[network].network).toBe(network);
      }
    });

    it('should have valid fullnode URLs', () => {
      expect(NETWORKS.mainnet.fullnodeUrl).toContain('mainnet');
      expect(NETWORKS.testnet.fullnodeUrl).toContain('testnet');
      expect(NETWORKS.devnet.fullnodeUrl).toContain('devnet');
      expect(NETWORKS.localnet.fullnodeUrl).toContain('127.0.0.1');
    });

    it('should have SEAL key servers for testnet', () => {
      expect(NETWORKS.testnet.sealKeyServers.length).toBeGreaterThan(0);
      for (const server of NETWORKS.testnet.sealKeyServers) {
        expect(server.objectId).toMatch(/^0x/);
        expect(server.weight).toBeGreaterThan(0);
      }
    });

    it('should have Walrus URLs for testnet', () => {
      expect(NETWORKS.testnet.walrusAggregatorUrl).toContain('walrus');
      expect(NETWORKS.testnet.walrusPublisherUrl).toContain('walrus');
    });
  });
});

describe('CoinTypes', () => {
  describe('when accessing coin constants', () => {
    it('should have correct SUI coin type', () => {
      expect(COIN_TYPES.SUI).toBe('0x2::sui::SUI');
    });

    it('should have USDC and USDT with 6 decimals', () => {
      expect(COIN_DECIMALS[COIN_TYPES.USDC]).toBe(6);
      expect(COIN_DECIMALS[COIN_TYPES.USDT]).toBe(6);
    });

    it('should have SUI with 9 decimals', () => {
      expect(COIN_DECIMALS[COIN_TYPES.SUI]).toBe(9);
    });

    it('should have USDC and USDT coin types as 0x-prefixed', () => {
      expect(COIN_TYPES.USDC).toMatch(/^0x/);
      expect(COIN_TYPES.USDT).toMatch(/^0x/);
    });
  });
});

describe('BrandedAddresses', () => {
  describe('when validating Sui addresses', () => {
    it('should accept valid hex addresses', () => {
      const addr = toSuiAddress('0xabcdef1234567890');
      expect(addr).toBe('0xabcdef1234567890');
    });

    it('should reject addresses without 0x prefix', () => {
      expect(() => toSuiAddress('abcdef')).toThrow('Invalid Sui address');
    });

    it('should reject empty strings', () => {
      expect(() => toSuiAddress('')).toThrow('Invalid Sui address');
    });

    it('should reject addresses with invalid hex chars', () => {
      expect(() => toSuiAddress('0xZZZZ')).toThrow('Invalid Sui address');
    });
  });

  describe('when validating object IDs', () => {
    it('should accept valid hex object IDs', () => {
      const id = toObjectId('0x1234');
      expect(id).toBe('0x1234');
    });

    it('should reject invalid object IDs', () => {
      expect(() => toObjectId('not-an-id')).toThrow('Invalid Sui object ID');
    });
  });

  describe('isValidSuiAddress', () => {
    it('should return true for valid addresses', () => {
      expect(isValidSuiAddress('0xabcdef')).toBe(true);
      expect(isValidSuiAddress('0x1')).toBe(true);
    });

    it('should return false for invalid addresses', () => {
      expect(isValidSuiAddress('')).toBe(false);
      expect(isValidSuiAddress('not-valid')).toBe(false);
      expect(isValidSuiAddress('0x')).toBe(false);
    });
  });
});
