import { describe, it, expect } from 'vitest';
import {
  fromX402Requirements,
  fromX402Payload,
  toX402Requirements,
  toX402Payload,
  isS402,
  isX402,
  normalizeRequirements,
  S402_VERSION,
  type s402PaymentRequirements,
  type s402ExactPayload,
  type x402PaymentRequirements,
} from '../../src/s402/index.js';

const SAMPLE_X402: x402PaymentRequirements = {
  x402Version: 1,
  scheme: 'exact',
  network: 'sui:testnet',
  asset: '0x2::sui::SUI',
  amount: '1000000000',
  payTo: '0xabc',
  facilitatorUrl: 'https://facilitator.example.com',
};

const SAMPLE_S402: s402PaymentRequirements = {
  s402Version: S402_VERSION,
  accepts: ['exact', 'stream'],
  network: 'sui:testnet',
  asset: '0x2::sui::SUI',
  amount: '1000000000',
  payTo: '0xabc',
  facilitatorUrl: 'https://facilitator.example.com',
  protocolFeeBps: 50,
  mandate: { required: true },
};

describe('s402 compat layer', () => {
  describe('fromX402Requirements', () => {
    it('converts x402 to s402 format', () => {
      const s402 = fromX402Requirements(SAMPLE_X402);

      expect(s402.s402Version).toBe('1');
      expect(s402.accepts).toEqual(['exact']);
      expect(s402.network).toBe('sui:testnet');
      expect(s402.amount).toBe('1000000000');
      expect(s402.payTo).toBe('0xabc');
      expect(s402.facilitatorUrl).toBe('https://facilitator.example.com');
    });
  });

  describe('toX402Requirements', () => {
    it('converts s402 to x402 format, stripping s402-only fields', () => {
      const x402 = toX402Requirements(SAMPLE_S402);

      expect(x402.x402Version).toBe(1);
      expect(x402.scheme).toBe('exact');
      expect(x402.network).toBe('sui:testnet');
      expect(x402.amount).toBe('1000000000');
      // s402-only fields should NOT be present
      expect('mandate' in x402).toBe(false);
      expect('protocolFeeBps' in x402).toBe(false);
      expect('accepts' in x402).toBe(false);
    });
  });

  describe('roundtrip', () => {
    it('fromX402(toX402(s402)) preserves x402-compatible fields', () => {
      const x402 = toX402Requirements(SAMPLE_S402);
      const roundtripped = fromX402Requirements(x402);

      expect(roundtripped.network).toBe(SAMPLE_S402.network);
      expect(roundtripped.asset).toBe(SAMPLE_S402.asset);
      expect(roundtripped.amount).toBe(SAMPLE_S402.amount);
      expect(roundtripped.payTo).toBe(SAMPLE_S402.payTo);
      expect(roundtripped.facilitatorUrl).toBe(SAMPLE_S402.facilitatorUrl);
    });

    it('roundtrip strips s402-only fields', () => {
      const x402 = toX402Requirements(SAMPLE_S402);
      const roundtripped = fromX402Requirements(x402);

      // mandate was s402-only, gets stripped in x402 conversion
      expect(roundtripped.mandate).toBeUndefined();
      expect(roundtripped.protocolFeeBps).toBeUndefined();
    });
  });

  describe('payload conversion', () => {
    it('fromX402Payload converts to s402 exact payload', () => {
      const x402Payload = {
        x402Version: 1,
        scheme: 'exact',
        payload: { transaction: 'txbytes', signature: 'sig' },
      };
      const s402 = fromX402Payload(x402Payload);

      expect(s402.s402Version).toBe('1');
      expect(s402.scheme).toBe('exact');
      expect(s402.payload.transaction).toBe('txbytes');
    });

    it('toX402Payload converts exact payload', () => {
      const s402Payload: s402ExactPayload = {
        s402Version: S402_VERSION,
        scheme: 'exact',
        payload: { transaction: 'txbytes', signature: 'sig' },
      };
      const x402 = toX402Payload(s402Payload);

      expect(x402).not.toBeNull();
      expect(x402!.x402Version).toBe(1);
      expect(x402!.payload.transaction).toBe('txbytes');
    });

    it('toX402Payload returns null for non-exact schemes', () => {
      const streamPayload = {
        s402Version: S402_VERSION as typeof S402_VERSION,
        scheme: 'stream' as const,
        payload: { transaction: 'tx', signature: 'sig' },
      };
      expect(toX402Payload(streamPayload)).toBeNull();
    });
  });

  describe('detection helpers', () => {
    it('isS402 detects s402 objects', () => {
      expect(isS402({ s402Version: '1' })).toBe(true);
      expect(isS402({ x402Version: 1 })).toBe(false);
      expect(isS402({})).toBe(false);
    });

    it('isX402 detects x402 objects', () => {
      expect(isX402({ x402Version: 1 })).toBe(true);
      expect(isX402({ s402Version: '1' })).toBe(false);
      // Object with both fields is s402 (superset)
      expect(isX402({ x402Version: 1, s402Version: '1' })).toBe(false);
    });
  });

  describe('normalizeRequirements', () => {
    it('passes through s402 requirements', () => {
      const result = normalizeRequirements({ s402Version: '1', accepts: ['exact'], network: 'sui:testnet', asset: '0x2::sui::SUI', amount: '100', payTo: '0x1' });
      expect(result.s402Version).toBe('1');
    });

    it('converts x402 requirements', () => {
      const result = normalizeRequirements({ x402Version: 1, scheme: 'exact', network: 'sui:testnet', asset: '0x2::sui::SUI', amount: '100', payTo: '0x1' });
      expect(result.s402Version).toBe('1');
      expect(result.accepts).toEqual(['exact']);
    });

    it('throws on unknown format', () => {
      expect(() => normalizeRequirements({ foo: 'bar' })).toThrow('Unrecognized');
    });
  });
});
