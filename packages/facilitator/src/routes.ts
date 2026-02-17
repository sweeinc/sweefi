import { Hono } from "hono";
import type { Context } from "hono";
import type { s402Facilitator } from "s402";
import { S402_VERSION, isValidAmount } from "s402";
import { pickRequirementsFields } from "s402/http";
import { recordSettlement } from "./metering/hooks";
import type { UsageTracker } from "./metering/usage-tracker";

/** Extract API key set by auth middleware. */
function getApiKey(c: Context): string | undefined {
  try {
    return (c as any).get("apiKey") as string | undefined;
  } catch {
    return undefined;
  }
}

const VALID_SCHEMES = new Set<string>(["exact", "stream", "escrow", "unlock", "prepaid"]);

/** Validate the shape of a settlement request body. Returns an error string or null if valid. */
function validateSettlementBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (!b.paymentPayload || typeof b.paymentPayload !== "object") return "Missing or invalid paymentPayload";
  if (!b.paymentRequirements || typeof b.paymentRequirements !== "object") return "Missing or invalid paymentRequirements";

  const payload = b.paymentPayload as Record<string, unknown>;
  if (typeof payload.scheme !== "string" || !VALID_SCHEMES.has(payload.scheme)) {
    return `Invalid scheme: "${payload.scheme}". Must be one of: ${[...VALID_SCHEMES].join(", ")}`;
  }

  // A-11: Validate inner payload fields — all schemes require transaction + signature as strings
  const inner = payload.payload;
  if (inner == null || typeof inner !== "object") {
    return "paymentPayload.payload must be an object containing transaction and signature";
  }
  const innerObj = inner as Record<string, unknown>;
  if (typeof innerObj.transaction !== "string") {
    return `paymentPayload.payload.transaction must be a string, got ${typeof innerObj.transaction}`;
  }
  if (typeof innerObj.signature !== "string") {
    return `paymentPayload.payload.signature must be a string, got ${typeof innerObj.signature}`;
  }

  const reqs = b.paymentRequirements as Record<string, unknown>;
  if (typeof reqs.network !== "string" || reqs.network.length === 0) return "paymentRequirements.network is required";
  if (typeof reqs.amount !== "string" || reqs.amount.length === 0) return "paymentRequirements.amount is required";
  if (!isValidAmount(reqs.amount as string)) {
    return `paymentRequirements.amount must be a non-negative integer string, got "${reqs.amount}"`;
  }
  if (typeof reqs.payTo !== "string" || reqs.payTo.length === 0) return "paymentRequirements.payTo is required";
  // D-07: Basic payTo address format validation (Sui hex addresses)
  if (typeof reqs.payTo === "string" && !reqs.payTo.startsWith("0x")) {
    return `paymentRequirements.payTo must be a hex address starting with "0x", got "${reqs.payTo}"`;
  }

  return null;
}

/**
 * Create Hono routes for the facilitator endpoints.
 *
 * B-05/B-06 (Fee verification): The facilitator trusts that the scheme
 * implementation verifies fee correctness at the Move contract level.
 * The HTTP routes do NOT independently verify that protocolFeeBps in the
 * requirements matches what the Sui PTB actually collects. This is correct:
 * the facilitator's on-chain scheme implementation (ExactScheme.settle) builds
 * the PTB with the fee split, and Sui's execution verifies balance conservation.
 * A dishonest resource server cannot reduce fees because the facilitator
 * controls the PTB construction. Operators deploying custom scheme implementations
 * MUST ensure their Move contracts enforce fee collection.
 */
export function createRoutes(
  facilitator: s402Facilitator,
  usageTracker: UsageTracker,
  feeBps: number,
) {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/supported", (c) => {
    // List all supported networks and their schemes
    const networks: Record<string, string[]> = {};
    for (const network of ["sui:testnet", "sui:mainnet"]) {
      const schemes = facilitator.supportedSchemes(network);
      if (schemes.length > 0) {
        networks[network] = schemes;
      }
    }
    return c.json({ s402Version: S402_VERSION, networks });
  });

  app.post("/verify", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const validationError = validateSettlementBody(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    try {
      // A-12: Strip unknown fields from requirements at the trust boundary
      const cleanReqs = pickRequirementsFields(body.paymentRequirements);
      const result = await facilitator.verify(
        body.paymentPayload,
        cleanReqs,
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

    const validationError = validateSettlementBody(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    try {
      const cleanReqs = pickRequirementsFields(body.paymentRequirements);
      const result = await facilitator.settle(
        body.paymentPayload,
        cleanReqs,
      );

      // Inline metering — record settlement on success
      if (result.success) {
        const apiKey = getApiKey(c);
        if (apiKey) {
          recordSettlement(usageTracker, apiKey, body.paymentRequirements, result, feeBps);
        }
      }

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Settlement failed";
      return c.json({ error: message }, 500);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // s402 atomic route (verify + settle in one call)
  // ══════════════════════════════════════════════════════════════

  app.post("/s402/process", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const validationError = validateSettlementBody(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    try {
      const cleanReqs = pickRequirementsFields(body.paymentRequirements);
      const result = await facilitator.process(
        body.paymentPayload,
        cleanReqs,
      );

      // Inline metering
      if (result.success) {
        const apiKey = getApiKey(c);
        if (apiKey) {
          recordSettlement(usageTracker, apiKey, body.paymentRequirements, result, feeBps);
        }
      }

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/.well-known/s402.json", (c) => {
    const schemes = new Set<string>();
    const networkList: string[] = [];

    for (const network of ["sui:testnet", "sui:mainnet"]) {
      const supported = facilitator.supportedSchemes(network);
      if (supported.length > 0) {
        networkList.push(network);
        for (const s of supported) schemes.add(s);
      }
    }

    return c.json({
      s402Version: S402_VERSION,
      schemes: [...schemes],
      networks: networkList,
      assets: [],
      directSettlement: true,
      mandateSupport: false,
      protocolFeeBps: feeBps,
    });
  });

  return app;
}
