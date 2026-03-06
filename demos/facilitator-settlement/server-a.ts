/**
 * Server A — Resource Provider (API Server)
 *
 * Demonstrates how an API provider integrates SweeFi with ZERO blockchain code.
 * Uses s402Gate middleware to gate premium endpoints behind payments.
 * Delegates ALL settlement to the facilitator (Server B).
 *
 * Server A knows NOTHING about Sui — it just forwards payments to the facilitator.
 *
 * Endpoints:
 *   GET /api/weather       → Free (no payment required)
 *   GET /api/forecast      → 10,000 MIST (delegates to facilitator)
 *   GET /api/alpha-signals → 50,000 MIST (delegates to facilitator)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { s402Gate } from "@sweefi/server";
import type { s402PaymentRequirements, s402SettleResponse } from "s402";

// ══════════════════════════════════════════════════════════════
// Configuration (safe at module scope — no validation that throws)
// ══════════════════════════════════════════════════════════════

const PORT = Number(process.env.SERVER_PORT ?? 3402);
const NETWORK = "sui:testnet";
const ASSET = "0x2::sui::SUI";

// Where the facilitator is running
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4022";
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY ?? "demo-facilitator-key-0123456789abcdef";

// Fee configuration — convert facilitator's FEE_MICRO_PERCENT (1M scale) to protocolFeeBps (10K scale)
// Example: FEE_MICRO_PERCENT=50000 (5%) → protocolFeeBps=500 (5%)
const FEE_MICRO_PERCENT = Number(process.env.FEE_MICRO_PERCENT ?? "0");
const PROTOCOL_FEE_BPS = Math.floor(FEE_MICRO_PERCENT / 100);
const PROTOCOL_FEE_ADDRESS = process.env.FEE_RECIPIENT || undefined;

// ══════════════════════════════════════════════════════════════
// Facilitator delegation — Server A's ONLY blockchain interaction
// ══════════════════════════════════════════════════════════════

/**
 * Forward a payment to the facilitator for verification + settlement.
 * This is the ONLY function that touches the facilitator. Server A
 * has zero Sui SDK imports — it just does HTTP.
 */
async function processPaymentViaFacilitator(
  payload: unknown,
  requirements: s402PaymentRequirements,
): Promise<s402SettleResponse> {
  const response = await fetch(`${FACILITATOR_URL}/s402/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FACILITATOR_API_KEY}`,
    },
    body: JSON.stringify({
      paymentPayload: payload,
      paymentRequirements: requirements,
    }),
  });

  if (!response.ok) {
    // Preserve structured error details from the facilitator
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await response.json()) as { error?: string };
        return { success: false, error: body.error ?? `Facilitator error (${response.status})` };
      } catch { /* fall through to text */ }
    }
    const text = await response.text();
    return { success: false, error: `Facilitator error (${response.status}): ${text}` };
  }

  return response.json() as Promise<s402SettleResponse>;
}

// ══════════════════════════════════════════════════════════════
// App factory — built at server-start time so MERCHANT_ADDRESS
// is validated before routes are registered (not at import time,
// which would bypass the demo orchestrator's error handling).
// ══════════════════════════════════════════════════════════════

function createApp(merchantAddress: string) {
  const app = new Hono();

  // Request logging
  app.use("*", async (c, next) => {
    const start = Date.now();
    console.log(`\n→ ${c.req.method} ${new URL(c.req.url).pathname}`);
    await next();
    console.log(`← ${c.res.status} (${Date.now() - start}ms)`);
  });

  // ── Free endpoint ─────────────────────────────────────────────

  app.get("/api/weather", (c) => {
    return c.json({
      location: "San Francisco",
      temperature: 62,
      unit: "F",
      condition: "Partly Cloudy",
      source: "SweeFi Demo API (free tier)",
    });
  });

  // ── Premium endpoints (s402-gated, facilitator-settled) ───────

  app.get(
    "/api/forecast",
    s402Gate({
      price: "10000",
      network: NETWORK,
      payTo: merchantAddress,
      asset: ASSET,
      facilitatorUrl: FACILITATOR_URL,
      protocolFeeBps: PROTOCOL_FEE_BPS || undefined,
      protocolFeeAddress: PROTOCOL_FEE_ADDRESS,
      processPayment: processPaymentViaFacilitator,
    }),
    (c) => {
      return c.json({
        location: "San Francisco",
        forecast: [
          { day: "Mon", high: 65, low: 52, condition: "Sunny" },
          { day: "Tue", high: 63, low: 50, condition: "Partly Cloudy" },
          { day: "Wed", high: 61, low: 49, condition: "Fog" },
          { day: "Thu", high: 64, low: 51, condition: "Sunny" },
          { day: "Fri", high: 66, low: 53, condition: "Clear" },
          { day: "Sat", high: 68, low: 54, condition: "Sunny" },
          { day: "Sun", high: 67, low: 52, condition: "Partly Cloudy" },
        ],
        model: "SweeFi Weather AI v2",
        confidence: 0.94,
        paid: true,
        settledVia: "facilitator",
        source: "SweeFi Demo API (premium — settled via facilitator!)",
      });
    },
  );

  app.get(
    "/api/alpha-signals",
    s402Gate({
      price: "50000",
      network: NETWORK,
      payTo: merchantAddress,
      asset: ASSET,
      facilitatorUrl: FACILITATOR_URL,
      protocolFeeBps: PROTOCOL_FEE_BPS || undefined,
      protocolFeeAddress: PROTOCOL_FEE_ADDRESS,
      processPayment: processPaymentViaFacilitator,
    }),
    (c) => {
      return c.json({
        signals: [
          { asset: "SUI/USDC", direction: "long", confidence: 0.87, entry: 1.42, target: 1.58 },
          { asset: "ETH/USDC", direction: "short", confidence: 0.72, entry: 3200, target: 3050 },
          { asset: "BTC/USDC", direction: "long", confidence: 0.91, entry: 97500, target: 105000 },
        ],
        generated: new Date().toISOString(),
        model: "SweeFi Alpha AI v3",
        disclaimer: "Demo signals only. Not financial advice.",
        paid: true,
        settledVia: "facilitator",
        source: "SweeFi Demo API (premium — settled via facilitator!)",
      });
    },
  );

  // ── Health check ──────────────────────────────────────────────

  app.get("/health", (c) => c.json({ status: "ok", role: "resource-provider" }));

  return app;
}

// ══════════════════════════════════════════════════════════════
// Start server
// ══════════════════════════════════════════════════════════════

export function startServer(port = PORT): Promise<ReturnType<typeof serve>> {
  // Validate MERCHANT_ADDRESS at runtime (not import-time) so the demo
  // orchestrator's try/finally cleanup can handle the error gracefully.
  const merchantAddress = process.env.MERCHANT_ADDRESS;
  if (!merchantAddress) {
    throw new Error(
      "MERCHANT_ADDRESS env var is required (Sui address 0x + 64 hex chars). " +
      "For demo, use your own testnet address so you can verify settlement on-chain.",
    );
  }

  const app = createApp(merchantAddress);

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║  Server A — Resource Provider (delegates to facilitator)  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Endpoints:                                              ║
║    GET /api/weather        FREE                          ║
║    GET /api/forecast       10,000 MIST (facilitator)     ║
║    GET /api/alpha-signals  50,000 MIST (facilitator)     ║
║                                                          ║
║  Facilitator: ${FACILITATOR_URL.padEnd(39)}║
║  Network: Sui Testnet                                    ║
║  Port: ${String(port).padEnd(51)}║
║                                                          ║
║  Zero Sui SDK imports — all settlement delegated.        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`);
      resolve(server);
    });
  });
}

// Run standalone
if (process.argv[1]?.endsWith("server-a.ts")) {
  startServer();
}
