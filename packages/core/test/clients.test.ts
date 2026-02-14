import { describe, it, expect, vi } from 'vitest';
import { createSuiClient } from '../src/clients/sui-client-factory.js';
import { getSealKeyServers, getSealThreshold } from '../src/config/seal-key-servers.js';
import type { SuiNetwork } from '../src/types/network.js';

describe('createSuiClient', () => {
  describe('when creating clients for different networks', () => {
    it('should create a client for testnet', () => {
      const client = createSuiClient('testnet');
      expect(client).toBeDefined();
    });

    it('should create a client for mainnet', () => {
      const client = createSuiClient('mainnet');
      expect(client).toBeDefined();
    });

    it('should create a client for devnet', () => {
      const client = createSuiClient('devnet');
      expect(client).toBeDefined();
    });

    it('should create a client for localnet', () => {
      const client = createSuiClient('localnet');
      expect(client).toBeDefined();
    });

    it('should create distinct client instances', () => {
      const a = createSuiClient('testnet');
      const b = createSuiClient('testnet');
      expect(a).not.toBe(b);
    });
  });
});

describe('getSealKeyServers', () => {
  describe('when querying key servers', () => {
    it('should return key servers for testnet', () => {
      const servers = getSealKeyServers('testnet');
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should return empty array for devnet', () => {
      const servers = getSealKeyServers('devnet');
      expect(servers).toEqual([]);
    });

    it('should return empty array for localnet', () => {
      const servers = getSealKeyServers('localnet');
      expect(servers).toEqual([]);
    });
  });
});

describe('getSealThreshold', () => {
  describe('when computing threshold', () => {
    it('should return majority for testnet', () => {
      const threshold = getSealThreshold('testnet');
      const servers = getSealKeyServers('testnet');
      expect(threshold).toBe(Math.ceil(servers.length / 2));
    });

    it('should return 0 for networks with no key servers', () => {
      expect(getSealThreshold('devnet')).toBe(0);
      expect(getSealThreshold('localnet')).toBe(0);
    });
  });
});
