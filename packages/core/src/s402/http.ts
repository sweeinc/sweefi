/**
 * s402 HTTP Helpers — encode/decode for HTTP headers
 *
 * Wire-compatible with x402: same header names, same base64 encoding.
 * The presence of `s402Version` in the decoded JSON distinguishes s402 from x402.
 */

import type {
  s402PaymentRequirements,
  s402PaymentPayload,
  s402SettleResponse,
} from './types.js';
import { S402_HEADERS } from './types.js';

// ══════════════════════════════════════════════════════════════
// Encode (object → base64 string for HTTP header)
// ══════════════════════════════════════════════════════════════

/** Encode payment requirements for the `payment-required` header */
export function encodePaymentRequired(requirements: s402PaymentRequirements): string {
  return btoa(JSON.stringify(requirements));
}

/** Encode payment payload for the `X-PAYMENT` header */
export function encodePaymentPayload(payload: s402PaymentPayload): string {
  return btoa(JSON.stringify(payload));
}

/** Encode settlement response for the `payment-response` header */
export function encodeSettleResponse(response: s402SettleResponse): string {
  return btoa(JSON.stringify(response));
}

// ══════════════════════════════════════════════════════════════
// Decode (base64 string from HTTP header → object)
// ══════════════════════════════════════════════════════════════

/** Decode payment requirements from the `payment-required` header */
export function decodePaymentRequired(header: string): s402PaymentRequirements {
  return JSON.parse(atob(header)) as s402PaymentRequirements;
}

/** Decode payment payload from the `X-PAYMENT` header */
export function decodePaymentPayload(header: string): s402PaymentPayload {
  return JSON.parse(atob(header)) as s402PaymentPayload;
}

/** Decode settlement response from the `payment-response` header */
export function decodeSettleResponse(header: string): s402SettleResponse {
  return JSON.parse(atob(header)) as s402SettleResponse;
}

// ══════════════════════════════════════════════════════════════
// Protocol detection
// ══════════════════════════════════════════════════════════════

/**
 * Detect whether a 402 response uses s402 or x402 protocol.
 *
 * Check: decode the `payment-required` header and look for `s402Version`.
 * If present → s402. If absent → x402 (or raw 402).
 */
export function detectProtocol(headers: Headers): 's402' | 'x402' | 'unknown' {
  const paymentRequired = headers.get(S402_HEADERS.PAYMENT_REQUIRED);
  if (!paymentRequired) return 'unknown';

  try {
    const decoded = JSON.parse(atob(paymentRequired));
    if (decoded.s402Version) return 's402';
    // x402 uses x402Version field
    if (decoded.x402Version) return 'x402';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Extract payment requirements from a 402 Response.
 * Works with both s402 and x402 responses.
 */
export function extractRequirementsFromResponse(response: Response): s402PaymentRequirements | null {
  const header = response.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
  if (!header) return null;

  try {
    return decodePaymentRequired(header);
  } catch {
    return null;
  }
}
