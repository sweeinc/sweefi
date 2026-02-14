/**
 * s402 Fetch Wrapper — replaces @x402/fetch dependency
 *
 * Wraps global fetch to auto-handle 402 responses:
 *   1. Detects 402 response
 *   2. Checks protocol (s402 or x402) via detectProtocol()
 *   3. Decodes payment requirements
 *   4. Creates payment via s402Client
 *   5. Retries request with X-PAYMENT header
 *
 * Wire-compatible with both s402 and x402 servers.
 */

import type { s402Client } from '@sweepay/core';
import {
  detectProtocol,
  encodePaymentPayload,
  S402_HEADERS,
  normalizeRequirements,
} from '@sweepay/core';

export interface s402FetchOptions {
  /** Facilitator URL for settlement */
  facilitatorUrl?: string;
  /** Maximum retry attempts after 402 (default: 1) */
  maxRetries?: number;
}

/**
 * Wrap a fetch function with automatic s402/x402 payment handling.
 *
 * @param baseFetch - The underlying fetch function (usually globalThis.fetch)
 * @param client - The s402Client with registered schemes
 * @param options - Configuration options
 * @returns A wrapped fetch function
 */
export function wrapFetchWithS402(
  baseFetch: typeof globalThis.fetch,
  client: s402Client,
  options: s402FetchOptions = {},
): typeof globalThis.fetch {
  const maxRetries = options.maxRetries ?? 1;

  return async function s402Fetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    // Make initial request
    const response = await baseFetch(input, init);

    // Not a 402 — pass through
    if (response.status !== 402) {
      return response;
    }

    // Detect protocol
    const protocol = detectProtocol(response.headers);
    if (protocol === 'unknown') {
      // No payment-required header — return raw 402
      return response;
    }

    // Decode requirements
    const headerValue = response.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
    if (!headerValue) return response;

    let requirements;
    try {
      const decoded = JSON.parse(atob(headerValue));
      requirements = normalizeRequirements(decoded);
    } catch {
      return response;
    }

    // Create payment
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const payload = await client.createPayment(requirements);
        const encoded = encodePaymentPayload(payload);

        // Retry with payment header
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set(S402_HEADERS.PAYMENT, encoded);

        const retryResponse = await baseFetch(input, {
          ...init,
          headers: retryHeaders,
        });

        // If still 402, decode new requirements and retry
        if (retryResponse.status === 402 && retries + 1 < maxRetries) {
          retries++;
          continue;
        }

        return retryResponse;
      } catch {
        retries++;
        if (retries >= maxRetries) {
          return response; // Return original 402
        }
      }
    }

    return response;
  };
}
