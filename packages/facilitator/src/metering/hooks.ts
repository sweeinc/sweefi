import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import type { x402Facilitator } from "@sweepay/core/facilitator";
import { UsageTracker } from "./usage-tracker";
import { calculateFee } from "./fee-calculator";

/**
 * Request-scoped storage for the authenticated API key.
 * Bridges Hono's per-request context with x402's global facilitator hooks.
 */
export const requestApiKey = new AsyncLocalStorage<string>();

/**
 * Hono middleware that propagates the authenticated API key
 * into AsyncLocalStorage so facilitator hooks can access it.
 *
 * Must be mounted AFTER apiKeyAuth (which sets c.get("apiKey")).
 */
export function meteringContext(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.get("apiKey") as string | undefined;
    if (apiKey) {
      await requestApiKey.run(apiKey, next);
    } else {
      await next();
    }
  };
}

/**
 * Register metering lifecycle hooks on the facilitator.
 *
 * onAfterSettle (x402 only fires this on success):
 *   1. Record settlement in UsageTracker (keyed by API key)
 *   2. Calculate facilitator fee (Phase 1: structured log, Phase 2: on-chain split)
 *
 * Hook errors are caught and logged — a metering failure must never
 * break the payment response to the client.
 */
export function registerMeteringHooks(
  facilitator: x402Facilitator,
  tracker: UsageTracker,
  feeBps: number,
): void {
  facilitator.onAfterSettle(async (ctx) => {
    const apiKey = requestApiKey.getStore();
    if (!apiKey) return;

    try {
      tracker.record(
        apiKey,
        ctx.requirements.amount,
        ctx.result.network,
        ctx.result.transaction,
      );

      const fee = calculateFee(ctx.requirements.amount, feeBps);

      // Phase 1: structured log for manual invoicing
      // Phase 2: replace with on-chain fee splitting via Move contract
      console.log(JSON.stringify({
        event: "settlement_metered",
        apiKey: apiKey.slice(0, 8) + "...",
        amount: ctx.requirements.amount,
        fee: fee.toString(),
        feeBps,
        network: ctx.result.network,
        txDigest: ctx.result.transaction,
        payer: ctx.result.payer,
      }));
    } catch (err) {
      // Metering failure must not break the payment flow
      console.error("[metering] hook error:", err);
    }
  });
}
