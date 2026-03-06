/**
 * s402 Fetch Wrapper
 *
 * Wraps global fetch to auto-handle 402 responses:
 *   1. Detects 402 response
 *   2. Reads payment-required header
 *   3. Decodes s402 payment requirements
 *   4. Creates payment via s402Client
 *   5. Retries request with x-payment header
 */

import type { s402Client, s402PaymentRequirements } from 's402';
import {
  encodePaymentPayload,
  S402_HEADERS,
  decodePaymentRequired,
} from 's402';

export interface s402FetchOptions {
  /** Facilitator URL for settlement */
  facilitatorUrl?: string;
  /** Maximum retry attempts after 402 (default: 1) */
  maxRetries?: number;
}

/**
 * Error thrown when payment was submitted but the follow-up request failed.
 * The payment may have been processed server-side — DO NOT retry blindly.
 * Check the transaction digest before retrying.
 */
export class s402PaymentSentError extends Error {
  readonly code = 'PAYMENT_SENT_RESPONSE_LOST';
  readonly requirements: s402PaymentRequirements;

  constructor(requirements: s402PaymentRequirements, _cause?: unknown) {
    super(
      `Payment was submitted but the response was lost (network error). ` +
      `The payment may have been processed. Check on-chain state before retrying. ` +
      `Amount: ${requirements.amount}, payTo: ${requirements.payTo}`,
    );
    this.name = 's402PaymentSentError';
    this.requirements = requirements;
  }
}

/**
 * Wrap a fetch function with automatic s402 payment handling.
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

    // Check for payment-required header
    const headerValue = response.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
    if (!headerValue) {
      // No payment-required header — return raw 402
      return response;
    }

    // Decode requirements
    let requirements: s402PaymentRequirements;
    try {
      requirements = decodePaymentRequired(headerValue);
    } catch {
      return response;
    }

    // Create payment once and cache — retries reuse the same payload to avoid double-spend.
    // A new payment is only created if the server returns fresh requirements
    // (different amount, payTo, asset, or network).
    let cachedPayload: ReturnType<typeof encodePaymentPayload> | null = null;
    let cachedRequirements = requirements;
    let paymentCreated = false;
    let retries = 0;
    while (retries < maxRetries) {
      // Only create a new payment if requirements changed or no cached payload
      if (!cachedPayload || cachedRequirements !== requirements) {
        let payload;
        try {
          payload = await client.createPayment(requirements);
        } catch (createError) {
          // All createPayment errors are non-retryable (mandate auth failures,
          // missing config, etc.) — bubble up immediately
          throw createError;
        }
        cachedPayload = encodePaymentPayload(payload);
        cachedRequirements = requirements;
        paymentCreated = true;
      }

      // Retry with payment header
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set(S402_HEADERS.PAYMENT, cachedPayload);

      let retryResponse: Response;
      try {
        retryResponse = await baseFetch(input, {
          ...init,
          headers: retryHeaders,
        });
      } catch (networkError) {
        // D-17 fix: payment was sent — DO NOT silently return original 402.
        // The server may have processed the payment. Throw a specific error
        // so the caller knows to check on-chain state before retrying.
        if (paymentCreated) {
          throw new s402PaymentSentError(requirements, networkError);
        }
        // If payment wasn't created yet, safe to return original 402
        retries++;
        if (retries >= maxRetries) {
          return response;
        }
        continue;
      }

      // If still 402, re-decode fresh requirements from the new response
      if (retryResponse.status === 402 && retries + 1 < maxRetries) {
        const freshHeader = retryResponse.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
        if (freshHeader) {
          try {
            const freshReqs = decodePaymentRequired(freshHeader);
            // A-23 fix: compare asset + network in addition to amount + payTo
            if (
              freshReqs.amount !== requirements.amount ||
              freshReqs.payTo !== requirements.payTo ||
              freshReqs.asset !== requirements.asset ||
              freshReqs.network !== requirements.network
            ) {
              requirements = freshReqs;
            }
          } catch {
            // Keep existing requirements and cached payload
          }
        }
        retries++;
        continue;
      }

      return retryResponse;
    }

    return response;
  };
}
