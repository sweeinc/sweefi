/**
 * s402 ↔ x402 Compatibility Layer
 *
 * Enables bidirectional interop:
 *   - x402 clients can talk to s402 servers (via "exact" scheme)
 *   - s402 clients can talk to x402 servers (graceful degradation)
 *
 * Roundtrip: fromX402(toX402(s402)) preserves all x402 fields.
 * s402-only fields (mandate, stream, escrow, seal extras) are stripped.
 */

import type { s402PaymentRequirements, s402ExactPayload, s402PaymentPayload } from './types.js';
import { S402_VERSION } from './types.js';

// ══════════════════════════════════════════════════════════════
// x402 types (minimal — just what we need for conversion)
// ══════════════════════════════════════════════════════════════

/** Minimal x402 PaymentRequirements shape (from @x402/core) */
export interface x402PaymentRequirements {
  x402Version: number;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  facilitatorUrl?: string;
  extra?: Record<string, unknown>;
}

/** Minimal x402 PaymentPayload shape */
export interface x402PaymentPayload {
  x402Version: number;
  scheme: string;
  payload: {
    transaction: string;
    signature: string;
  };
}

// ══════════════════════════════════════════════════════════════
// Convert x402 → s402
// ══════════════════════════════════════════════════════════════

/**
 * Convert inbound x402 requirements to s402 format.
 * Maps x402's single scheme to s402's accepts array.
 * Always sets scheme to "exact" (x402 only supports exact payments).
 */
export function fromX402Requirements(x402: x402PaymentRequirements): s402PaymentRequirements {
  return {
    s402Version: S402_VERSION,
    accepts: ['exact'],
    network: x402.network,
    asset: x402.asset,
    amount: x402.amount,
    payTo: x402.payTo,
    facilitatorUrl: x402.facilitatorUrl,
    extra: x402.extra,
  };
}

/**
 * Convert inbound x402 payment payload to s402 format.
 */
export function fromX402Payload(x402: x402PaymentPayload): s402ExactPayload {
  return {
    s402Version: S402_VERSION,
    scheme: 'exact',
    payload: {
      transaction: x402.payload.transaction,
      signature: x402.payload.signature,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Convert s402 → x402
// ══════════════════════════════════════════════════════════════

/**
 * Convert outbound s402 requirements to x402 format.
 * Strips s402-only fields (mandate, stream, escrow, seal extras).
 * Only works for "exact" scheme — other schemes have no x402 equivalent.
 */
export function toX402Requirements(s402: s402PaymentRequirements): x402PaymentRequirements {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: s402.network,
    asset: s402.asset,
    amount: s402.amount,
    payTo: s402.payTo,
    facilitatorUrl: s402.facilitatorUrl,
    extra: s402.extra,
  };
}

/**
 * Convert outbound s402 payload to x402 format.
 * Only works for exact scheme payloads.
 */
export function toX402Payload(s402: s402PaymentPayload): x402PaymentPayload | null {
  if (s402.scheme !== 'exact') return null;

  const exact = s402 as s402ExactPayload;
  return {
    x402Version: 1,
    scheme: 'exact',
    payload: {
      transaction: exact.payload.transaction,
      signature: exact.payload.signature,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Detection helpers
// ══════════════════════════════════════════════════════════════

/**
 * Check if a decoded JSON object is s402 format.
 */
export function isS402(obj: Record<string, unknown>): boolean {
  return 's402Version' in obj;
}

/**
 * Check if a decoded JSON object is x402 format.
 */
export function isX402(obj: Record<string, unknown>): boolean {
  return 'x402Version' in obj && !('s402Version' in obj);
}

/**
 * Auto-detect and normalize: if x402, convert to s402. If already s402, pass through.
 */
export function normalizeRequirements(
  obj: Record<string, unknown>,
): s402PaymentRequirements {
  if (isS402(obj)) {
    return obj as unknown as s402PaymentRequirements;
  }
  if (isX402(obj)) {
    return fromX402Requirements(obj as unknown as x402PaymentRequirements);
  }
  throw new Error('Unrecognized payment requirements format: missing s402Version or x402Version');
}
