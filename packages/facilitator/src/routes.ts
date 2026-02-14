import { Hono } from "hono";
import type { x402Facilitator } from "@sweepay/core/facilitator";

/**
 * Create Hono routes for the facilitator endpoints.
 */
export function createRoutes(facilitator: x402Facilitator) {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/supported", (c) => {
    return c.json(facilitator.getSupported());
  });

  app.post("/verify", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body?.paymentPayload || !body?.paymentRequirements) {
      return c.json({ error: "Missing required fields: paymentPayload, paymentRequirements" }, 400);
    }

    try {
      const result = await facilitator.verify(
        body.paymentPayload,
        body.paymentRequirements,
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/settle", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body?.paymentPayload || !body?.paymentRequirements) {
      return c.json({ error: "Missing required fields: paymentPayload, paymentRequirements" }, 400);
    }

    try {
      const result = await facilitator.settle(
        body.paymentPayload,
        body.paymentRequirements,
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Settlement failed";
      return c.json({ error: message }, 500);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // s402 routes (Sui-native optimization: atomic verify+settle)
  // ══════════════════════════════════════════════════════════════

  app.post("/s402/process", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body?.paymentPayload || !body?.paymentRequirements) {
      return c.json({ error: "Missing required fields: paymentPayload, paymentRequirements" }, 400);
    }

    try {
      // Atomic: verify + settle in one call (eliminates temporal gap)
      const verifyResult = await facilitator.verify(
        body.paymentPayload,
        body.paymentRequirements,
      );

      if (!verifyResult.isValid) {
        return c.json({
          success: false,
          error: verifyResult.invalidReason ?? "Verification failed",
        });
      }

      const settleResult = await facilitator.settle(
        body.paymentPayload,
        body.paymentRequirements,
      );

      return c.json(settleResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/.well-known/s402.json", (c) => {
    const supported = facilitator.getSupported();
    return c.json({
      s402Version: "1",
      schemes: ["exact"],
      networks: supported.kinds?.map((k: { network: string }) => k.network) ?? [],
      assets: [],
      directSettlement: true,
      mandateSupport: false,
      protocolFeeBps: 0,
    });
  });

  return app;
}
