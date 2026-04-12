/**
 * s402 Server Middleware — Hono middleware for gating routes behind payments
 *
 * Returns HTTP 402 with s402 payment requirements for unpaid requests.
 * On payment: decodes X-PAYMENT header, verifies via facilitator, grants access.
 *
 * Always includes "exact" in accepts array (base scheme).
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono';
 * import { s402Gate } from '@sweefi/hono';
 *
 * const app = new Hono();
 *
 * app.use('/api/data', s402Gate({
 *   price: '1000000',
 *   network: 'sui:testnet',
 *   payTo: '0xYOUR_ADDRESS',
 *   schemes: ['exact'],
 * }));
 *
 * app.get('/api/data', (c) => c.json({ weather: 'sunny' }));
 * ```
 */

import type { Context, MiddlewareHandler } from 'hono';
import {
  S402_VERSION,
  S402_HEADERS,
  encodePaymentRequired,
  decodePaymentPayload,
  encodeSettleResponse,
} from 's402';
import type {
  s402PaymentRequirements,
  s402Scheme,
  s402SettleResponse,
} from 's402';

export interface s402GateConfig {
  /** Payment amount in base units */
  price: string;
  /** Sui network (e.g., "sui:testnet") */
  network: string;
  /** Recipient address */
  payTo: string;
  /** Accepted schemes (always includes "exact") */
  schemes?: s402Scheme[];
  /** Coin type (default: SUI) */
  asset?: string;
  /** Facilitator URL */
  facilitatorUrl?: string;
  /** Protocol fee in basis points */
  protocolFeeBps?: number;
  /** Address that receives the protocol fee (if different from payTo) */
  protocolFeeAddress?: string;
  /** Mandate requirements */
  mandate?: { required: boolean; minPerTx?: string };
  /** Prepaid scheme config (included in requirements when schemes includes 'prepaid') */
  prepaid?: {
    ratePerCall: string;
    maxCalls?: string;
    minDeposit: string;
    withdrawalDelayMs: string;
  };
  /** Gas station config — when set, the facilitator sponsors gas for transactions */
  gasStation?: { sponsorAddress: string; maxBudget?: string };
  /** Custom verify+settle handler (overrides built-in facilitator call) */
  processPayment?: (payload: unknown, requirements: s402PaymentRequirements) => Promise<s402SettleResponse>;
}

export function s402Gate(config: s402GateConfig): MiddlewareHandler {
  const {
    price,
    network,
    payTo,
    schemes = ['exact'],
    asset = '0x2::sui::SUI',
    facilitatorUrl,
    protocolFeeBps,
    protocolFeeAddress,
    mandate,
    prepaid,
    gasStation,
  } = config;

  // Validate protocolFeeBps at construction time (fail fast on misconfig)
  if (protocolFeeBps !== undefined) {
    if (!Number.isInteger(protocolFeeBps) || protocolFeeBps < 0 || protocolFeeBps > 10000) {
      throw new Error(
        `protocolFeeBps must be an integer 0-10000 (basis points), got ${protocolFeeBps}`,
      );
    }
  }

  // Always include "exact" (base scheme)
  const accepts: s402Scheme[] = [...new Set([...schemes, 'exact' as const])];

  // Build requirements once — used for both the 402 response and processPayment handler.
  // Single source of truth prevents field drift between the two paths (F-V01 fix).
  const requirements: s402PaymentRequirements = {
    s402Version: S402_VERSION,
    accepts,
    network,
    asset,
    amount: price,
    payTo,
    facilitatorUrl,
    protocolFeeBps,
    protocolFeeAddress,
    mandate: mandate ? { required: mandate.required, minPerTx: mandate.minPerTx } : undefined,
    extensions: gasStation ? { gasStation } : undefined,
    prepaid: prepaid ? {
      ratePerCall: prepaid.ratePerCall,
      maxCalls: prepaid.maxCalls,
      minDeposit: prepaid.minDeposit,
      withdrawalDelayMs: prepaid.withdrawalDelayMs,
    } : undefined,
  };

  return async (c: Context, next) => {
    // Check for existing payment
    const paymentHeader = c.req.header(S402_HEADERS.PAYMENT);

    if (!paymentHeader) {
      // No payment — return 402 with requirements
      const encoded = encodePaymentRequired(requirements);

      return c.json(
        { error: 'Payment Required', s402Version: S402_VERSION },
        402,
        {
          [S402_HEADERS.PAYMENT_REQUIRED]: encoded,
        },
      );
    }

    // Payment present — decode and process
    try {
      const payload = decodePaymentPayload(paymentHeader);

      // Verify the payment scheme is accepted
      if (!accepts.includes(payload.scheme)) {
        return c.json({ error: `Scheme "${payload.scheme}" not accepted` }, 400);
      }

      // Verify and settle payment via the provided handler
      if (config.processPayment) {
        const result = await config.processPayment(payload, requirements);

        if (!result.success) {
          return c.json({ error: result.error ?? 'Payment failed' }, 402);
        }

        // Store receipt in context for downstream handlers
        c.set('s402Receipt', result);

        // Add settlement response header
        c.header(S402_HEADERS.PAYMENT_RESPONSE, encodeSettleResponse(result));
      } else {
        // No settlement handler configured — fail closed.
        // Payment header was decoded and scheme-validated, but the payment
        // has NOT been verified or settled on-chain. Granting access here
        // would allow any well-formed (but potentially unfunded) payload through.
        return c.json(
          { error: 'Payment settlement not configured. Server must provide a processPayment handler.' },
          402,
        );
      }

      await next();
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Invalid payment' },
        400,
      );
    }
  };
}
