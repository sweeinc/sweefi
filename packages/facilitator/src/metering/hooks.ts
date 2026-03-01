import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { UsageTracker } from "./usage-tracker";
import { calculateFee } from "./fee-calculator";
import type { s402SettleResponse, s402PaymentRequirements } from "s402";

/**
 * Request-scoped storage for the authenticated API key.
 * Bridges Hono's per-request context with inline metering.
 */
export const requestApiKey = new AsyncLocalStorage<string>();

/**
 * Hono middleware that propagates the authenticated API key
 * into AsyncLocalStorage so metering utilities can access it.
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
 * Record a successful settlement for metering.
 * Called inline from route handlers after a successful settle/process.
 *
 * Errors are caught and logged — metering failure must never
 * break the payment response to the client.
 */
export function recordSettlement(
  tracker: UsageTracker,
  apiKey: string,
  requirements: s402PaymentRequirements,
  result: s402SettleResponse,
  feeMicroPercent: number,
): void {
  try {
    tracker.record(
      apiKey,
      requirements.amount,
      requirements.network,
      result.txDigest ?? "",
    );

    const fee = calculateFee(requirements.amount, feeMicroPercent);

    // Phase 1: structured log for manual invoicing
    // Phase 2: replace with on-chain fee splitting via Move contract
    console.log(JSON.stringify({
      event: "settlement_metered",
      apiKey: createHash("sha256").update(apiKey).digest("hex").slice(0, 8),
      amount: requirements.amount,
      fee: fee.toString(),
      feeMicroPercent,
      network: requirements.network,
      txDigest: result.txDigest,
    }));
  } catch (err) {
    // Metering failure must not break the payment flow
    console.error("[metering] recordSettlement error:", err);
  }
}
