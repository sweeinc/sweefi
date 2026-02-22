/**
 * Integration Test — Full s402 Protocol Flow
 *
 * Tests the complete HTTP round-trip using Hono + s402Gate:
 *   Client request → 402 → parse requirements → craft payment → retry → 200
 *
 * Uses a mock processPayment handler so we can test the entire
 * protocol chain without depending on Sui testnet.
 *
 * What this proves:
 * - s402Gate() returns proper 402 with payment-required header
 * - Payment requirements encode/decode correctly (base64 JSON)
 * - x-payment header is parsed and forwarded to processPayment handler
 * - Settlement response header is returned on success
 * - Free routes pass through without payment
 * - Invalid/missing scheme payloads are rejected
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { s402Gate } from "../../src/server/s402-gate";
import type { s402GateConfig } from "../../src/server/s402-gate";
import {
  S402_HEADERS,
  S402_VERSION,
  decodePaymentRequired,
} from "s402";
import type { s402SettleResponse } from "s402";

// ─── Test Constants ──────────────────────────────────────────────────────────

const TEST_PAY_TO = "0x" + "bb".repeat(32);
const TEST_TX_DIGEST = "integration-test-tx-digest-123";

// ─── Mock Settlement ─────────────────────────────────────────────────────────

function createMockProcessor() {
  const calls: Array<{ payload: unknown; requirements: unknown }> = [];

  const processPayment = vi.fn(
    async (
      payload: unknown,
      requirements: unknown,
    ): Promise<s402SettleResponse> => {
      calls.push({ payload, requirements });
      return {
        success: true,
        txDigest: TEST_TX_DIGEST,
      };
    },
  );

  return { processPayment, calls };
}

// ─── App Factory ─────────────────────────────────────────────────────────────

function createApp(overrides?: Partial<s402GateConfig>) {
  const { processPayment, calls } = createMockProcessor();

  const app = new Hono();

  app.use(
    "/api/data",
    s402Gate({
      price: "1000000",
      network: "sui:testnet",
      payTo: TEST_PAY_TO,
      schemes: ["exact"],
      processPayment,
      ...overrides,
    }),
  );

  app.get("/api/data", (c) =>
    c.json({ message: "premium data", temp: 72 }),
  );

  app.get("/free", (c) => c.json({ message: "free data" }));

  return { app, processPayment, calls };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodeBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64<T>(str: string): T {
  const binary = atob(str);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

/**
 * Build a minimal valid s402 exact payment payload for testing.
 * Matches s402ExactPayload: { s402Version, scheme, payload: { transaction, signature } }
 */
function buildTestPayload() {
  return {
    s402Version: S402_VERSION,
    scheme: "exact" as const,
    payload: {
      transaction: "mock-signed-transaction-bytes-base64",
      signature: "mock-ed25519-signature-base64",
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Full s402 Protocol Flow", () => {
  // ── 402 Response ────────────────────────────────────────────────────────

  it("returns 402 with payment-required header for unpaid request", async () => {
    const { app } = createApp();
    const res = await app.request("/api/data");

    expect(res.status).toBe(402);

    const header = res.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
    expect(header).toBeTruthy();

    const requirements = decodePaymentRequired(header!);
    expect(requirements.s402Version).toBe(S402_VERSION);
    expect(requirements.accepts).toContain("exact");
  });

  it("payment requirements contain correct network, amount, and payTo", async () => {
    const { app } = createApp();
    const res = await app.request("/api/data");
    const header = res.headers.get(S402_HEADERS.PAYMENT_REQUIRED)!;
    const requirements = decodePaymentRequired(header);

    expect(requirements.network).toBe("sui:testnet");
    expect(requirements.amount).toBe("1000000");
    expect(requirements.payTo).toBe(TEST_PAY_TO);
  });

  it("402 body includes s402Version", async () => {
    const { app } = createApp();
    const res = await app.request("/api/data");
    const body = await res.json();

    expect(body.s402Version).toBe(S402_VERSION);
    expect(body.error).toBe("Payment Required");
  });

  // ── Successful Payment ─────────────────────────────────────────────────

  it("returns 200 with data when valid payment is provided", async () => {
    const { app } = createApp();

    const payload = buildTestPayload();
    const encoded = encodeBase64(payload);

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "premium data", temp: 72 });
  });

  it("calls processPayment with decoded payload and requirements", async () => {
    const { app, processPayment } = createApp();

    const payload = buildTestPayload();
    const encoded = encodeBase64(payload);

    await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(processPayment).toHaveBeenCalledOnce();
    const [receivedPayload, receivedRequirements] =
      processPayment.mock.calls[0];

    // Payload was decoded correctly
    expect(receivedPayload).toMatchObject({
      scheme: "exact",
      payload: {
        transaction: "mock-signed-transaction-bytes-base64",
        signature: "mock-ed25519-signature-base64",
      },
    });

    // Requirements match config
    expect(receivedRequirements).toMatchObject({
      s402Version: S402_VERSION,
      network: "sui:testnet",
      amount: "1000000",
      payTo: TEST_PAY_TO,
    });
  });

  it("returns payment-response header with settlement details", async () => {
    const { app } = createApp();

    const payload = buildTestPayload();
    const encoded = encodeBase64(payload);

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(res.status).toBe(200);

    const responseHeader = res.headers.get(S402_HEADERS.PAYMENT_RESPONSE);
    expect(responseHeader).toBeTruthy();

    const settleResponse = decodeBase64<s402SettleResponse>(responseHeader!);
    expect(settleResponse.success).toBe(true);
    expect(settleResponse.txDigest).toBe(TEST_TX_DIGEST);
  });

  // ── Scheme Validation ──────────────────────────────────────────────────

  it("rejects payment with unaccepted scheme", async () => {
    const { app } = createApp({ schemes: ["exact"] });

    const payload = {
      s402Version: S402_VERSION,
      scheme: "stream",
      payload: { transaction: "tx", signature: "sig" },
    };
    const encoded = encodeBase64(payload);

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("stream");
  });

  // ── Settlement Failure ─────────────────────────────────────────────────

  it("returns 402 when processPayment indicates failure", async () => {
    const failProcessor = async (): Promise<s402SettleResponse> => ({
      success: false,
      error: "Insufficient balance",
    });

    const { app } = createApp({ processPayment: failProcessor });

    const payload = buildTestPayload();
    const encoded = encodeBase64(payload);

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("Insufficient balance");
  });

  // ── No processPayment Handler ──────────────────────────────────────────

  it("returns 402 when no processPayment handler is configured", async () => {
    const app = new Hono();
    app.use(
      "/api/data",
      s402Gate({
        price: "1000000",
        network: "sui:testnet",
        payTo: TEST_PAY_TO,
      }),
    );
    app.get("/api/data", (c) => c.json({ data: "secret" }));

    const payload = buildTestPayload();
    const encoded = encodeBase64(payload);

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: encoded },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toContain("not configured");
  });

  // ── Pass-through ───────────────────────────────────────────────────────

  it("free routes pass through without payment", async () => {
    const { app } = createApp();
    const res = await app.request("/free");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "free data" });
  });

  // ── Invalid Payment ────────────────────────────────────────────────────

  it("returns 400 for malformed payment header", async () => {
    const { app } = createApp();

    const res = await app.request("/api/data", {
      headers: { [S402_HEADERS.PAYMENT]: "not-valid-base64!!!" },
    });

    expect(res.status).toBe(400);
  });
});
