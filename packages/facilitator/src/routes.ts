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
 * FEE VERIFICATION (V8 audit F-04):
 * - **Exact scheme**: Fees are NOT enforced. The client builds the PTB (not
 *   the facilitator), and `protocolFeeAddress` is not in requirements. Both
 *   coin splits go to `payTo`. Exact is fee-free by design in v0.1.
 * - **Escrow/stream/prepaid**: Fees ARE enforced on-chain by Move contracts.
 *   The facilitator verifies fee_micro_pct via emitted events.
 *
 * Operators who need exact-scheme fees must add `protocolFeeAddress` to
 * s402GateConfig and update the verify logic. See exact/client.ts header.
 */
export function createRoutes(
  facilitator: s402Facilitator,
  usageTracker: UsageTracker,
  feeMicroPercent: number,
  feeRecipient?: string,
  serverStartTime: Date = new Date(),
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
          recordSettlement(usageTracker, apiKey, body.paymentRequirements, result, feeMicroPercent);
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
          recordSettlement(usageTracker, apiKey, body.paymentRequirements, result, feeMicroPercent);
        }
      }

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * Facilitator identity endpoint — signed fee schedule.
   *
   * Clients SHOULD verify this before trusting the facilitator's fee claims.
   * The `signature` field will be added once the FACILITATOR_KEYPAIR is wired
   * for signing. Until then, this is an informational transparency endpoint.
   *
   * Per ADR: this endpoint is separate from /.well-known/s402.json because
   * it describes the FACILITATOR (who settles) not the RESOURCE SERVER (who charges).
   * Those are two different actors in the s402 protocol.
   */
  app.get("/.well-known/s402-facilitator", (c) => {
    const networks: string[] = [];
    const schemes = new Set<string>();

    for (const network of ["sui:testnet", "sui:mainnet"]) {
      const supported = facilitator.supportedSchemes(network);
      if (supported.length > 0) {
        networks.push(network);
        for (const s of supported) schemes.add(s);
      }
    }

    // validUntil is rolling 30-day window — update at each deploy.
    // When FACILITATOR_KEYPAIR is present, this payload will be signed
    // so clients can verify authenticity via the facilitator's public key.
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    return c.json({
      version: "1",
      feeMicroPercent,
      feeRecipient: feeRecipient ?? null,
      minFeeUsd: "0.001",
      supportedSchemes: [...schemes],
      supportedNetworks: networks,
      validUntil,
      // signature: "<ed25519 signature over canonical JSON — added when keypair is wired>"
    });
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
      protocolFeeMicroPercent: feeMicroPercent,
    });
  });

  /**
   * Per-key settlement history.
   *
   * Returns all settlements recorded for the authenticated API key since the
   * server last started. Supports offset-based pagination.
   *
   * IMPORTANT — dataRetainedSince: UsageTracker is in-memory (Phase 1).
   * Records are lost on restart. The dataRetainedSince field tells callers
   * exactly when the current retention window began so they know gaps exist
   * before that timestamp. Do not use this endpoint as a sole audit trail —
   * cross-reference with on-chain transaction digests for full history.
   */
  app.get("/settlements", (c) => {
    const apiKey = getApiKey(c);
    if (!apiKey) {
      return c.json({ error: "API key not found in context" }, 401);
    }

    const limitParam = parseInt(c.req.query("limit") ?? "100", 10);
    const offsetParam = parseInt(c.req.query("offset") ?? "0", 10);
    const limit = Math.min(Math.max(1, Number.isNaN(limitParam) ? 100 : limitParam), 1000);
    const offset = Math.max(0, Number.isNaN(offsetParam) ? 0 : offsetParam);

    const allRecords = usageTracker.getAllRecords();
    const keyRecords = allRecords.get(apiKey) ?? [];
    const totalSettled = usageTracker.getTotalSettled(apiKey).toString();
    const paginated = keyRecords.slice(offset, offset + limit);

    return c.json({
      dataRetainedSince: serverStartTime.toISOString(),
      totalSettled,
      count: keyRecords.length,
      records: paginated,
    });
  });

  return app;
}
