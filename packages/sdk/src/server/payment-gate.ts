import { HTTPFacilitatorClient, x402ResourceServer } from "@sweepay/core/server";
import { paymentMiddleware } from "@x402/hono";
import { ExactSuiScheme } from "@sweepay/sui/exact/server";
import { DEFAULT_FACILITATOR_URL } from "../shared/constants";
import type { PaymentGateConfig } from "./types";

/**
 * Hono middleware that gates API routes behind x402 payments on Sui.
 *
 * Returns HTTP 402 with payment requirements for unpaid requests.
 * Automatically verifies and settles payments via the hosted facilitator.
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono';
 * import { paymentGate } from '@sweepay/sdk/server';
 *
 * const app = new Hono();
 *
 * app.use('/api/data', paymentGate({
 *   price: '$0.001',
 *   network: 'sui:testnet',
 *   payTo: '0xYOUR_ADDRESS',
 * }));
 *
 * app.get('/api/data', (c) => c.json({ weather: 'sunny', temp: 72 }));
 * ```
 */
export function paymentGate(config: PaymentGateConfig) {
  const { price, network, payTo, facilitatorUrl, maxTimeoutSeconds = 30, apiKey } = config;

  // Point to the facilitator (hosted or custom)
  const facilitatorClient = new HTTPFacilitatorClient({
    url: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
    ...(apiKey && {
      createAuthHeaders: async () => {
        const headers = { Authorization: `Bearer ${apiKey}` };
        return { verify: headers, settle: headers, supported: headers };
      },
    }),
  });

  // Register Sui server scheme for price parsing
  const server = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactSuiScheme());

  // Single route config — applies to all requests that reach this middleware
  // (Express path matching happens before this middleware runs)
  const routeConfig = {
    accepts: {
      scheme: "exact",
      payTo,
      price,
      network,
      maxTimeoutSeconds,
    },
  };

  return paymentMiddleware(routeConfig, server);
}
