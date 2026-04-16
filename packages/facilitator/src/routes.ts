import { Hono } from "hono";
import type { Context } from "hono";
import type { s402Facilitator } from "s402";
import { S402_VERSION, isValidAmount } from "s402";
import { pickRequirementsFields } from "s402/http";
import { Transaction } from "@mysten/sui/transactions";
import { recordSettlement } from "./metering/hooks";
import type { UsageTracker } from "./metering/usage-tracker";
import type { IGasSponsorTracker } from "./metering/gas-sponsor-tracker";
import type { GasSponsorService } from "./gas-service";

/** Extract API key set by auth middleware. */
function getApiKey(c: Context): string | undefined {
  try {
    return (c as any).get("apiKey") as string | undefined;
  } catch {
    return undefined;
  }
}

const VALID_SCHEMES = new Set<string>(["exact", "stream", "escrow", "unlock", "prepaid", "upto"]);

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
  // D-07: Full payTo address format validation (Sui hex addresses — 0x + 64 hex chars)
  if (typeof reqs.payTo === "string" && !/^0x[a-fA-F0-9]{64}$/.test(reqs.payTo)) {
    return `paymentRequirements.payTo must be a valid Sui address (0x + 64 hex chars), got "${reqs.payTo}"`;
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
  gasSponsorTracker?: IGasSponsorTracker,
  gasSponsorService?: GasSponsorService,
) {
  const app = new Hono();

  // Root landing page — prevents Google Safe Browsing false positives on API-only domains
  app.get("/", (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>s402 Facilitator</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 4rem auto; padding: 1rem; }
    h1 { color: #6366f1; }
    code { background: #f1f5f9; padding: 0.2em 0.4em; border-radius: 4px; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <h1>s402 Facilitator</h1>
  <p>Payment verification and settlement service for the <a href="https://github.com/sweeinc/s402">s402 protocol</a>.</p>
  <h2>Endpoints</h2>
  <ul>
    <li><code>GET /ready</code> — Health check with RPC status</li>
    <li><code>GET /supported</code> — List supported networks and schemes</li>
    <li><code>POST /verify</code> — Verify a payment payload</li>
    <li><code>POST /settle</code> — Settle a verified payment</li>
    <li><code>GET /.well-known/s402-facilitator</code> — Facilitator discovery</li>
  </ul>
  <p>Docs: <a href="https://github.com/sweeinc/sweefi">github.com/sweeinc/sweefi</a></p>
</body>
</html>`);
  });

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
      console.error("[verify] Unexpected error:", err);
      return c.json({ error: "Internal verification error" }, 500);
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

        // Gas sponsor rate tracking: NOT recorded here. The /sponsor endpoint
        // already calls recordSponsored() when the facilitator sponsors gas.
        // Recording here too would double-count (each sponsored tx flows through
        // /sponsor then /settle). External sponsors don't consume our rate limit.

        // Recycle gas coin after sponsored settlement (fire-and-forget)
        if ((result as any).gasSponsored && result.txDigest) {
          reportSponsoredSettlement(result.txDigest, body.paymentPayload.payload.transaction);
        }
      }

      return c.json(result);
    } catch (err) {
      console.error("[settle] Unexpected error:", err);
      return c.json({ error: "Internal settlement error" }, 500);
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

        // Gas sponsor rate tracking: NOT recorded here (see /settle comment —
        // /sponsor already records, recording here would double-count).

        // Recycle gas coin after sponsored settlement (fire-and-forget)
        if ((result as any).gasSponsored && result.txDigest) {
          reportSponsoredSettlement(result.txDigest, body.paymentPayload.payload.transaction);
        }
      }

      return c.json(result);
    } catch (err) {
      console.error("[s402/process] Unexpected error:", err);
      return c.json({ error: "Internal processing error" }, 500);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // Gas sponsorship endpoint (kind-bytes workflow)
  // ══════════════════════════════════════════════════════════════

  /**
   * Sponsor a transaction's gas costs.
   *
   * The client builds a PTB with `tx.build({ onlyTransactionKind: true })` and
   * sends the kind bytes here. The facilitator:
   *   1. Validates policy (no gas coin drain, budget cap)
   *   2. Reserves a gas coin from the pool
   *   3. Reconstructs the full transaction with gas data
   *   4. Signs as gas sponsor
   *   5. Returns transaction bytes + sponsor signature
   *
   * The client then signs the returned bytes and submits via the normal s402
   * payment flow (x-payment header with dual signatures).
   *
   * Rate-limited by the GAS_SPONSOR_MAX_PER_HOUR setting per API key.
   */
  app.post("/sponsor", async (c) => {
    if (!gasSponsorService) {
      return c.json(
        { error: "Gas sponsorship is not enabled on this facilitator" },
        503,
      );
    }
    if (!gasSponsorService.initialized) {
      return c.json(
        { error: "Gas sponsor pool is initializing — try again shortly" },
        503,
      );
    }

    // Rate limit gas sponsorship per API key (atomic check-and-consume).
    // tryConsume() prevents the TOCTOU race where concurrent requests both
    // pass canSponsor() during the async sponsor() call between check and record.
    const apiKey = getApiKey(c);
    if (apiKey && gasSponsorTracker) {
      const consumed = await gasSponsorTracker.tryConsume(apiKey);
      if (!consumed) {
        return c.json(
          { error: "Gas sponsorship rate limit exceeded" },
          429,
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { sender, transactionKindBytes, network } = body;

    if (typeof sender !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(sender)) {
      return c.json(
        { error: "sender must be a valid Sui address (0x + 64 hex chars)" },
        400,
      );
    }
    if (typeof transactionKindBytes !== "string" || transactionKindBytes.length === 0) {
      return c.json(
        { error: "transactionKindBytes must be a non-empty base64 string" },
        400,
      );
    }
    if (typeof network !== "string" || !network.startsWith("sui:")) {
      return c.json(
        { error: 'network must be a CAIP-2 Sui network (e.g., "sui:testnet")' },
        400,
      );
    }

    try {
      const result = await gasSponsorService.sponsor(
        sender,
        transactionKindBytes,
        network,
      );

      // Rate token already consumed by tryConsume() above — no separate record needed.

      return c.json({
        transactionBytes: result.transactionBytes,
        sponsorSignature: result.sponsorSignature,
        gasBudget: result.gasBudget.toString(),
        gasPrice: result.gasPrice.toString(),
        sponsorAddress: gasSponsorService.address,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sponsorship failed";
      // Pool exhaustion is temporary — 503 so clients can retry.
      // Sponsor errors are operational (known failure modes), not internal leaks.
      if (message.includes("POOL_EXHAUSTED")) {
        return c.json({ error: "Gas sponsor pool temporarily exhausted" }, 503);
      }
      console.error("[sponsor] Sponsorship error:", err);
      return c.json({ error: "Sponsorship failed" }, 400);
    }
  });

  /**
   * After a sponsored settlement succeeds, report execution to the gas sponsor
   * for coin recycling. Fire-and-forget — errors are logged but don't affect
   * the settlement response.
   */
  function reportSponsoredSettlement(
    txDigest: string,
    transactionBytes: string,
  ): void {
    if (!gasSponsorService) return;

    try {
      const tx = Transaction.from(transactionBytes);
      const gasPayment = tx.getData().gasData.payment;
      const gasObjectId = gasPayment?.[0]?.objectId;

      if (gasObjectId) {
        gasSponsorService
          .reportSettlement(txDigest, gasObjectId)
          .catch((err) => {
            console.error(
              `[gas-service] Failed to report settlement for ${txDigest}:`,
              err,
            );
          });
      }
    } catch {
      // Transaction deserialization failed — can't recycle, coin will timeout
    }
  }

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

    // Advertise gas sponsorship when available
    const gasStation = gasSponsorService?.initialized
      ? { sponsorAddress: gasSponsorService.address, status: "active" }
      : gasSponsorService
        ? { status: "initializing" }
        : undefined;

    return c.json({
      version: "1",
      feeMicroPercent,
      feeRecipient: feeRecipient ?? null,
      minFeeUsd: "0.001",
      supportedSchemes: [...schemes],
      supportedNetworks: networks,
      ...(gasStation ? { gasStation } : {}),
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
      gasSponsorship: !!gasSponsorService,
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
