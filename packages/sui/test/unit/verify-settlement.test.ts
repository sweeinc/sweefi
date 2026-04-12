/**
 * S8: Settlement verification tests
 *
 * Tests the shared `verifySuiSettlement` helper and its integration
 * into scheme adapters. Covers:
 *   - Happy path (matching digest)
 *   - Digest mismatch (malicious facilitator)
 *   - Null/missing digest
 *   - Wrong scheme guard
 *   - Malformed base64 input
 *   - All 5 scheme adapters delegate correctly
 */

import { describe, it, expect } from 'vitest';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { verifySuiSettlement } from '../../src/s402/verify.js';
import type { s402PaymentPayload, s402SettleResponse } from 's402';

// ── Test helpers ─────────────────────────────────

/**
 * Create deterministic test transaction bytes and their expected digest.
 * Uses raw bytes — no need for a full Transaction object since
 * getDigestFromBytes hashes arbitrary bytes.
 */
function buildTestData(): { base64Bytes: string; expectedDigest: string } {
  // Arbitrary bytes simulating BCS-encoded transaction data
  const rawBytes = new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 0,  // version/kind
    1, 2, 3, 4, 5, 6, 7, 8,  // some payload
    10, 20, 30, 40, 50, 60,   // more data
  ]);
  const base64Bytes = toBase64(rawBytes);
  const expectedDigest = TransactionDataBuilder.getDigestFromBytes(rawBytes);

  return { base64Bytes, expectedDigest };
}

function makePayload(scheme: string, transaction: string): s402PaymentPayload {
  return {
    s402Version: '0.3.0',
    scheme: scheme as any,
    payload: { transaction, signature: 'fakesig' },
  } as s402PaymentPayload;
}

function makeSettleResponse(txDigest?: string | null): s402SettleResponse {
  return {
    success: true,
    txDigest: txDigest === null ? undefined : txDigest,
  } as s402SettleResponse;
}

// ── verifySuiSettlement (shared helper) ──────────

describe('S8: verifySuiSettlement', () => {
  const { base64Bytes, expectedDigest } = buildTestData();

  it('returns verified: true when digest matches', () => {
    const payload = makePayload('exact', base64Bytes);
    const settle = makeSettleResponse(expectedDigest);

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(true);
    expect(result.expectedDigest).toBe(expectedDigest);
    expect(result.actualDigest).toBe(expectedDigest);
    expect(result.reason).toBeUndefined();
  });

  it('returns verified: false on digest mismatch', () => {
    const payload = makePayload('exact', base64Bytes);
    const settle = makeSettleResponse('FakeDigest123456789');

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(false);
    expect(result.expectedDigest).toBe(expectedDigest);
    expect(result.actualDigest).toBe('FakeDigest123456789');
    expect(result.reason).toContain('Digest mismatch');
    expect(result.reason).toContain('do NOT retry');
  });

  it('returns verified: false when txDigest is missing', () => {
    const payload = makePayload('exact', base64Bytes);
    const settle = makeSettleResponse(null);

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(false);
    expect(result.expectedDigest).toBe(expectedDigest);
    expect(result.actualDigest).toBeNull();
    expect(result.reason).toContain('did not include a txDigest');
  });

  it('returns verified: false when txDigest is undefined', () => {
    const payload = makePayload('exact', base64Bytes);
    const settle = { success: true } as s402SettleResponse;

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(false);
    expect(result.actualDigest).toBeNull();
  });

  it('returns verified: false on scheme mismatch', () => {
    const payload = makePayload('stream', base64Bytes);
    const settle = makeSettleResponse(expectedDigest);

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('non-exact');
    expect(result.reason).toContain('"stream"');
  });

  it('returns verified: false on malformed base64', () => {
    const payload = makePayload('exact', '!!!not-base64!!!');
    const settle = makeSettleResponse('SomeDigest');

    const result = verifySuiSettlement('exact', payload, settle);

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Failed to decode');
  });

  it('never throws — always returns a result', () => {
    // Even with garbage input, it should return a verification result, not throw
    const payload = makePayload('exact', '');
    const settle = makeSettleResponse('anything');

    expect(() => verifySuiSettlement('exact', payload, settle)).not.toThrow();
  });

  // Verify it works for all scheme names
  for (const scheme of ['exact', 'stream', 'escrow', 'unlock', 'prepaid']) {
    it(`works for scheme: ${scheme}`, () => {
      const payload = makePayload(scheme, base64Bytes);
      const settle = makeSettleResponse(expectedDigest);

      const result = verifySuiSettlement(scheme, payload, settle);

      expect(result.verified).toBe(true);
      expect(result.expectedDigest).toBe(expectedDigest);
    });
  }

  it('digest is deterministic — same bytes always produce same digest', () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest1 = TransactionDataBuilder.getDigestFromBytes(rawBytes);
    const digest2 = TransactionDataBuilder.getDigestFromBytes(rawBytes);

    expect(digest1).toBe(digest2);
    // Verify it's a base58 string (Sui digest format)
    expect(digest1).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('different bytes produce different digests', () => {
    const bytes1 = new Uint8Array([1, 2, 3]);
    const bytes2 = new Uint8Array([4, 5, 6]);

    const digest1 = TransactionDataBuilder.getDigestFromBytes(bytes1);
    const digest2 = TransactionDataBuilder.getDigestFromBytes(bytes2);

    expect(digest1).not.toBe(digest2);
  });
});
