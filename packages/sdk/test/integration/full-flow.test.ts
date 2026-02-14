/**
 * Day 6 Integration Test — Full x402 Protocol Flow
 *
 * Tests the complete HTTP round-trip:
 *   Client request → 402 → parse requirements → craft payment → retry → 200
 *
 * Uses a mock facilitator (always returns valid/success) so we can test
 * the entire protocol chain without depending on Sui testnet.
 *
 * What this proves:
 * - paymentGate() returns proper 402 with PAYMENT-REQUIRED header
 * - Payment requirements encode correctly (base64 JSON)
 * - PAYMENT-SIGNATURE header is parsed and forwarded to facilitator
 * - Facilitator verify/settle are called with correct request format
 * - Response is buffered until settlement completes
 * - PAYMENT-RESPONSE header is returned on success
 * - Free routes pass through without payment
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { paymentGate } from "../../src/server/payment-gate";

// ─── Test Constants ──────────────────────────────────────────────────────────

const TEST_PAY_TO = "0x" + "bb".repeat(32);
const TEST_PAYER = "0x" + "aa".repeat(32);
const TEST_TX_DIGEST = "integration-test-tx-digest-123";
const TEST_API_KEY = "test-integration-key";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodeBase64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function decodeBase64<T>(str: string): T {
  return JSON.parse(Buffer.from(str, "base64").toString("utf8")) as T;
}

function getPort(server: Server): number {
  const addr = server.address();
  if (typeof addr === "object" && addr !== null) return addr.port;
  throw new Error("Server not bound to a port");
}

// ─── Mock Facilitator ────────────────────────────────────────────────────────

interface FacilitatorCall {
  path: string;
  body: Record<string, unknown>;
  authHeader?: string;
}

/**
 * Express server that mimics the swee-facilitator's HTTP API.
 * Always returns valid/success so we can test the protocol chain.
 */
function createMockFacilitator() {
  const app = express();
  app.use(express.json());
  const calls: FacilitatorCall[] = [];

  // Resource server calls /supported during initialization to validate
  // that the facilitator supports the configured scheme + network.
  app.get("/supported", (_req, res) => {
    res.json({
      kinds: [
        { x402Version: 2, scheme: "exact", network: "sui:testnet" },
      ],
      extensions: [],
      signers: {},
    });
  });

  // Verify always succeeds
  app.post("/verify", (req, res) => {
    calls.push({
      path: "/verify",
      body: req.body,
      authHeader: req.headers.authorization as string | undefined,
    });
    res.json({
      isValid: true,
      payer: TEST_PAYER,
    });
  });

  // Settle always succeeds
  app.post("/settle", (req, res) => {
    calls.push({
      path: "/settle",
      body: req.body,
      authHeader: req.headers.authorization as string | undefined,
    });
    res.json({
      success: true,
      payer: TEST_PAYER,
      transaction: TEST_TX_DIGEST,
      network: "sui:testnet",
    });
  });

  return { app, calls };
}

// ─── API Server ──────────────────────────────────────────────────────────────

function createApiServer(facilitatorUrl: string) {
  const app = express();

  // Protected route: requires payment
  app.use(
    "/api/data",
    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: TEST_PAY_TO,
      facilitatorUrl,
      apiKey: TEST_API_KEY,
    }),
  );

  app.get("/api/data", (_req, res) => {
    res.json({ message: "premium data", temp: 72 });
  });

  // Free route: no payment required
  app.get("/free", (_req, res) => {
    res.json({ message: "free data" });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Full x402 Protocol Flow (Mock Facilitator)", () => {
  let facilitatorServer: Server;
  let apiServer: Server;
  let facilitatorCalls: FacilitatorCall[];
  let apiUrl: string;

  beforeAll(async () => {
    // Start mock facilitator on random port
    const { app: facilitatorApp, calls } = createMockFacilitator();
    facilitatorCalls = calls;

    facilitatorServer = await new Promise<Server>((resolve) => {
      const server = facilitatorApp.listen(0, () => resolve(server));
    });
    const facilitatorUrl = `http://localhost:${getPort(facilitatorServer)}`;

    // Start API server on random port
    const apiApp = createApiServer(facilitatorUrl);
    apiServer = await new Promise<Server>((resolve) => {
      const server = apiApp.listen(0, () => resolve(server));
    });
    apiUrl = `http://localhost:${getPort(apiServer)}`;
  });

  afterAll(() => {
    facilitatorServer?.close();
    apiServer?.close();
  });

  // ── 402 Response ────────────────────────────────────────────────────────

  it("returns 402 with PAYMENT-REQUIRED header for unpaid request", async () => {
    const res = await fetch(`${apiUrl}/api/data`);
    expect(res.status).toBe(402);

    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();

    const paymentRequired = decodeBase64<any>(header!);
    expect(paymentRequired.x402Version).toBe(2);
    expect(paymentRequired.accepts).toBeInstanceOf(Array);
    expect(paymentRequired.accepts.length).toBeGreaterThan(0);
  });

  it("payment requirements contain correct scheme, network, and payTo", async () => {
    const res = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(res.headers.get("payment-required")!);
    const req = paymentRequired.accepts[0];

    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("sui:testnet");
    expect(req.payTo).toBe(TEST_PAY_TO);
  });

  it("payment requirements contain resource URL", async () => {
    const res = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(res.headers.get("payment-required")!);

    expect(paymentRequired.resource).toBeDefined();
    expect(paymentRequired.resource.url).toContain("/api/data");
  });

  // ── Successful Payment ─────────────────────────────────────────────────

  it("returns 200 with data when valid payment is provided", async () => {
    facilitatorCalls.length = 0;

    // Step 1: Get payment requirements
    const firstRes = await fetch(`${apiUrl}/api/data`);
    expect(firstRes.status).toBe(402);

    const paymentRequired = decodeBase64<any>(firstRes.headers.get("payment-required")!);
    const requirements = paymentRequired.accepts[0];

    // Step 2: Construct payment payload (simulates what client SDK does after signing)
    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: requirements,
      payload: {
        signature: "mock-ed25519-signature-base64",
        transaction: "mock-signed-transaction-bytes-base64",
      },
    };

    // Step 3: Retry with PAYMENT-SIGNATURE header
    const secondRes = await fetch(`${apiUrl}/api/data`, {
      headers: {
        "PAYMENT-SIGNATURE": encodeBase64(paymentPayload),
      },
    });

    expect(secondRes.status).toBe(200);
    const body = await secondRes.json();
    expect(body).toEqual({ message: "premium data", temp: 72 });
  });

  // ── Facilitator Integration ────────────────────────────────────────────

  it("calls facilitator /verify with correct payload shape", async () => {
    facilitatorCalls.length = 0;

    const firstRes = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(firstRes.headers.get("payment-required")!);

    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: paymentRequired.accepts[0],
      payload: { signature: "sig", transaction: "tx" },
    };

    await fetch(`${apiUrl}/api/data`, {
      headers: { "PAYMENT-SIGNATURE": encodeBase64(paymentPayload) },
    });

    const verifyCall = facilitatorCalls.find((c) => c.path === "/verify");
    expect(verifyCall).toBeTruthy();
    expect(verifyCall!.body).toHaveProperty("paymentPayload");
    expect(verifyCall!.body).toHaveProperty("paymentRequirements");
    expect(verifyCall!.body).toHaveProperty("x402Version", 2);
  });

  it("calls facilitator /settle after verification succeeds", async () => {
    facilitatorCalls.length = 0;

    const firstRes = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(firstRes.headers.get("payment-required")!);

    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: paymentRequired.accepts[0],
      payload: { signature: "sig", transaction: "tx" },
    };

    await fetch(`${apiUrl}/api/data`, {
      headers: { "PAYMENT-SIGNATURE": encodeBase64(paymentPayload) },
    });

    const settleCall = facilitatorCalls.find((c) => c.path === "/settle");
    expect(settleCall).toBeTruthy();
    expect(settleCall!.body).toHaveProperty("paymentPayload");
    expect(settleCall!.body).toHaveProperty("paymentRequirements");
  });

  it("returns PAYMENT-RESPONSE header with settlement details", async () => {
    const firstRes = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(firstRes.headers.get("payment-required")!);

    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: paymentRequired.accepts[0],
      payload: { signature: "sig", transaction: "tx" },
    };

    const secondRes = await fetch(`${apiUrl}/api/data`, {
      headers: { "PAYMENT-SIGNATURE": encodeBase64(paymentPayload) },
    });

    expect(secondRes.status).toBe(200);

    const responseHeader = secondRes.headers.get("payment-response");
    expect(responseHeader).toBeTruthy();

    const settleResponse = decodeBase64<any>(responseHeader!);
    expect(settleResponse.success).toBe(true);
    expect(settleResponse.transaction).toBe(TEST_TX_DIGEST);
    expect(settleResponse.network).toBe("sui:testnet");
    expect(settleResponse.payer).toBe(TEST_PAYER);
  });

  // ── Pass-through ───────────────────────────────────────────────────────

  it("free routes pass through without payment", async () => {
    const res = await fetch(`${apiUrl}/free`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "free data" });
  });

  // ── Auth Header Forwarding ─────────────────────────────────────────────

  it("forwards API key to facilitator via Authorization header", async () => {
    facilitatorCalls.length = 0;

    const firstRes = await fetch(`${apiUrl}/api/data`);
    const paymentRequired = decodeBase64<any>(firstRes.headers.get("payment-required")!);

    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: paymentRequired.accepts[0],
      payload: { signature: "sig", transaction: "tx" },
    };

    await fetch(`${apiUrl}/api/data`, {
      headers: { "PAYMENT-SIGNATURE": encodeBase64(paymentPayload) },
    });

    // Verify that the HTTPFacilitatorClient forwarded the Bearer token
    const verifyCall = facilitatorCalls.find((c) => c.path === "/verify");
    expect(verifyCall?.authHeader).toBe(`Bearer ${TEST_API_KEY}`);

    const settleCall = facilitatorCalls.find((c) => c.path === "/settle");
    expect(settleCall?.authHeader).toBe(`Bearer ${TEST_API_KEY}`);
  });
});
