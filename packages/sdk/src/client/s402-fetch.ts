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

import type { s402Client, s402PaymentRequirements } from 's402';
import {
  detectProtocol,
  encodePaymentPayload,
  S402_HEADERS,
  normalizeRequirements,
} from 's402';

/** Maximum base64 header size before decoding. Mirrors the 64KB limit in s402 core. */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * Decode a base64 string to UTF-8. Unicode-safe (handles CJK, emoji, etc.).
 * Mirrors the fromBase64 helper in s402/http which is not exported.
 */
function safeBase64Decode(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

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

    // Decode requirements (F-V02: unicode-safe base64 + size limit)
    let requirements = decodeRequirementsFromHeaders(response.headers);
    if (!requirements) return response;

    // Create payment and retry
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

        // If still 402, re-decode fresh requirements from the new response (F-V03 fix)
        if (retryResponse.status === 402 && retries + 1 < maxRetries) {
          const freshRequirements = decodeRequirementsFromHeaders(retryResponse.headers);
          if (freshRequirements) {
            requirements = freshRequirements;
          }
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

/**
 * Decode payment requirements from response headers.
 * Unicode-safe, size-limited, handles both s402 and x402 formats.
 */
function decodeRequirementsFromHeaders(headers: Headers): s402PaymentRequirements | null {
  const headerValue = headers.get(S402_HEADERS.PAYMENT_REQUIRED);
  if (!headerValue) return null;

  // Size limit defense — mirrors s402 core's 64KB cap
  if (headerValue.length > MAX_HEADER_BYTES) return null;

  try {
    const decoded = JSON.parse(safeBase64Decode(headerValue));
    return normalizeRequirements(decoded);
  } catch {
    return null;
  }
}
