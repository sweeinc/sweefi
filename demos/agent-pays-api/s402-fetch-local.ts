/**
 * Local s402 fetch wrapper for the demo.
 *
 * Simplified version of @sweefi/sdk's wrapFetchWithS402.
 * Intercepts 402 responses, auto-creates payment, retries.
 */

import type { s402Client } from "s402";
import {
  detectProtocol,
  S402_HEADERS,
  encodePaymentPayload,
} from "s402";
import type { s402PaymentRequirements } from "s402";

export function wrapFetchWithS402(
  baseFetch: typeof globalThis.fetch,
  client: s402Client,
): typeof globalThis.fetch {
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
    if (protocol === "unknown") {
      return response;
    }

    // Decode requirements from payment-required header
    const headerValue = response.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
    if (!headerValue) return response;

    let requirements: s402PaymentRequirements;
    try {
      requirements = JSON.parse(atob(headerValue));
    } catch {
      return response;
    }

    // Create payment via s402 client (signs a real Sui transaction)
    try {
      const payload = await client.createPayment(requirements);
      const encoded = encodePaymentPayload(payload);

      // Retry with payment header
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set(S402_HEADERS.PAYMENT, encoded);

      return await baseFetch(input, {
        ...init,
        headers: retryHeaders,
      });
    } catch (error) {
      console.error("  s402 payment failed:", error);
      return response; // Return original 402
    }
  };
}
