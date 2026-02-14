import { describe, it, expect } from 'vitest';
import {
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentPayload,
  decodePaymentPayload,
  encodeSettleResponse,
  decodeSettleResponse,
  detectProtocol,
  S402_VERSION,
  type s402PaymentRequirements,
  type s402ExactPayload,
  type s402SettleResponse,
} from '../../src/s402/index.js';

const SAMPLE_REQUIREMENTS: s402PaymentRequirements = {
  s402Version: S402_VERSION,
  accepts: ['exact'],
  network: 'sui:testnet',
  asset: '0x2::sui::SUI',
  amount: '1000000000',
  payTo: '0xabc123',
};

const SAMPLE_PAYLOAD: s402ExactPayload = {
  s402Version: S402_VERSION,
  scheme: 'exact',
  payload: {
    transaction: 'dHhieXRlcw==',
    signature: 'c2lnbmF0dXJl',
  },
};

const SAMPLE_SETTLE: s402SettleResponse = {
  success: true,
  txDigest: 'ABC123',
  receiptId: '0xreceipt',
  finalityMs: 450,
};

describe('s402 HTTP encode/decode', () => {
  describe('payment requirements roundtrip', () => {
    it('encodes and decodes without loss', () => {
      const encoded = encodePaymentRequired(SAMPLE_REQUIREMENTS);
      expect(typeof encoded).toBe('string');

      const decoded = decodePaymentRequired(encoded);
      expect(decoded.s402Version).toBe('1');
      expect(decoded.network).toBe('sui:testnet');
      expect(decoded.amount).toBe('1000000000');
      expect(decoded.accepts).toEqual(['exact']);
    });
  });

  describe('payment payload roundtrip', () => {
    it('encodes and decodes without loss', () => {
      const encoded = encodePaymentPayload(SAMPLE_PAYLOAD);
      const decoded = decodePaymentPayload(encoded);

      expect(decoded.scheme).toBe('exact');
      expect(decoded.s402Version).toBe('1');
      if (decoded.scheme === 'exact') {
        expect(decoded.payload.transaction).toBe('dHhieXRlcw==');
      }
    });
  });

  describe('settle response roundtrip', () => {
    it('encodes and decodes without loss', () => {
      const encoded = encodeSettleResponse(SAMPLE_SETTLE);
      const decoded = decodeSettleResponse(encoded);

      expect(decoded.success).toBe(true);
      expect(decoded.txDigest).toBe('ABC123');
      expect(decoded.receiptId).toBe('0xreceipt');
      expect(decoded.finalityMs).toBe(450);
    });
  });

  describe('detectProtocol', () => {
    it('detects s402 from payment-required header', () => {
      const headers = new Headers();
      headers.set('payment-required', encodePaymentRequired(SAMPLE_REQUIREMENTS));
      expect(detectProtocol(headers)).toBe('s402');
    });

    it('detects x402 from x402Version field', () => {
      const x402Req = { x402Version: 1, scheme: 'exact', network: 'sui:testnet' };
      const headers = new Headers();
      headers.set('payment-required', btoa(JSON.stringify(x402Req)));
      expect(detectProtocol(headers)).toBe('x402');
    });

    it('returns unknown for missing header', () => {
      const headers = new Headers();
      expect(detectProtocol(headers)).toBe('unknown');
    });

    it('returns unknown for invalid base64', () => {
      const headers = new Headers();
      headers.set('payment-required', '!!!not-base64!!!');
      expect(detectProtocol(headers)).toBe('unknown');
    });
  });
});
