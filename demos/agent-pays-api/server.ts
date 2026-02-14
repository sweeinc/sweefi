/**
 * s402 Demo Server — Premium API gated by Sui payments
 *
 * Endpoints:
 *   GET /api/weather       → Free (no payment required)
 *   GET /api/forecast      → 1,000 MIST (premium weather forecast)
 *   GET /api/alpha-signals → 5,000 MIST (premium AI trading signals)
 *   GET /.well-known/s402.json → Discovery endpoint
 *
 * The server uses s402Gate middleware to automatically:
 *   1. Return 402 with payment requirements for premium routes
 *   2. Accept X-PAYMENT header with signed Sui transactions
 *   3. Execute the payment on Sui testnet
 *   4. Serve the premium content
 *
 * Usage:
 *   tsx server.ts
 *   # or via demo.ts which starts both server + agent
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import {
  S402_VERSION,
  S402_HEADERS,
  encodePaymentRequired,
  decodePaymentPayload,
  encodeSettleResponse,
} from "@sweepay/core";
import type {
  s402PaymentRequirements,
  s402SettleResponse,
  s402ExactPayload,
} from "@sweepay/core";

// ══════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════

const PORT = Number(process.env.PORT ?? 3402);
const NETWORK = "sui:testnet";
const ASSET = "0x2::sui::SUI";

// Merchant wallet — receives payments
// In production, this would be the API operator's address
const MERCHANT_ADDRESS =
  process.env.MERCHANT_ADDRESS ??
  "0x0000000000000000000000000000000000000000000000000000000000000001";

const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });

// ══════════════════════════════════════════════════════════════
// Inline payment processor (acts as facilitator)
// ══════════════════════════════════════════════════════════════

/**
 * Process an s402 payment by executing the signed transaction on Sui testnet.
 * This is inline facilitator logic — no separate service needed.
 */
async function processPayment(
  payload: s402ExactPayload,
  _requirements: s402PaymentRequirements,
): Promise<s402SettleResponse> {
  try {
    const { transaction, signature } = payload.payload;

    // Execute the signed transaction on Sui
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: transaction,
      signature,
      options: {
        showEffects: true,
        showBalanceChanges: true,
      },
    });

    // Check execution success
    if (result.effects?.status?.status !== "success") {
      return {
        success: false,
        error: `Transaction failed: ${result.effects?.status?.error ?? "unknown"}`,
      };
    }

    // Wait for finality (Sui has ~2-3s finality)
    await suiClient.waitForTransaction({ digest: result.digest });

    return {
      success: true,
      txDigest: result.digest,
      finalityMs: 2500,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Settlement failed",
    };
  }
}

// ══════════════════════════════════════════════════════════════
// s402 Gate middleware (manual — not using the SDK middleware
// so the demo is self-contained and shows the protocol)
// ══════════════════════════════════════════════════════════════

function createGate(price: string, description: string) {
  return async (
    c: { req: { header: (name: string) => string | undefined }; json: Function; header: Function; set: Function },
    next: () => Promise<void>,
  ) => {
    // Check for payment header
    const paymentHeader = c.req.header(S402_HEADERS.PAYMENT);

    if (!paymentHeader) {
      // No payment — return 402 with requirements
      const requirements: s402PaymentRequirements = {
        s402Version: S402_VERSION,
        accepts: ["exact"],
        network: NETWORK,
        asset: ASSET,
        amount: price,
        payTo: MERCHANT_ADDRESS,
      };

      const encoded = encodePaymentRequired(requirements);

      console.log(`  💰 402 Payment Required: ${price} MIST for "${description}"`);

      return c.json(
        {
          error: "Payment Required",
          s402Version: S402_VERSION,
          description,
          price: `${price} MIST`,
        },
        402,
        { [S402_HEADERS.PAYMENT_REQUIRED]: encoded },
      );
    }

    // Payment present — decode and process
    try {
      const payload = decodePaymentPayload(paymentHeader);

      if (payload.scheme !== "exact") {
        return c.json({ error: `Scheme "${payload.scheme}" not supported in demo` }, 400);
      }

      console.log(`  🔄 Processing payment (scheme: ${payload.scheme})...`);

      const requirements: s402PaymentRequirements = {
        s402Version: S402_VERSION,
        accepts: ["exact"],
        network: NETWORK,
        asset: ASSET,
        amount: price,
        payTo: MERCHANT_ADDRESS,
      };

      const result = await processPayment(payload as s402ExactPayload, requirements);

      if (!result.success) {
        console.log(`  ❌ Payment failed: ${result.error}`);
        return c.json({ error: result.error ?? "Payment failed" }, 402);
      }

      console.log(`  ✅ Payment settled! TX: ${result.txDigest}`);

      // Store receipt and add settlement header
      c.set("s402Receipt", result);
      c.header(S402_HEADERS.PAYMENT_RESPONSE, encodeSettleResponse(result));

      await next();
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid payment" },
        400,
      );
    }
  };
}

// ══════════════════════════════════════════════════════════════
// App setup
// ══════════════════════════════════════════════════════════════

const app = new Hono();

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  console.log(`\n→ ${c.req.method} ${c.req.url}`);
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
    source: "s402 Demo API (free tier)",
  });
});

// ── Premium endpoints (s402-gated) ────────────────────────────

app.get("/api/forecast", createGate("1000", "7-Day Premium Forecast") as any, (c) => {
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
    model: "SweePay Weather AI v2",
    confidence: 0.94,
    paid: true,
    source: "s402 Demo API (premium tier — you paid for this!)",
  });
});

app.get("/api/alpha-signals", createGate("5000", "AI Trading Signals") as any, (c) => {
  return c.json({
    signals: [
      { asset: "SUI/USDC", direction: "long", confidence: 0.87, entry: 1.42, target: 1.58 },
      { asset: "ETH/USDC", direction: "short", confidence: 0.72, entry: 3200, target: 3050 },
      { asset: "BTC/USDC", direction: "long", confidence: 0.91, entry: 97500, target: 105000 },
    ],
    generated: new Date().toISOString(),
    model: "SweePay Alpha AI v3",
    disclaimer: "Demo signals only. Not financial advice.",
    paid: true,
    source: "s402 Demo API (premium tier — paid with SUI on testnet!)",
  });
});

// ── Discovery endpoint ────────────────────────────────────────

app.get("/.well-known/s402.json", (c) => {
  return c.json({
    s402Version: S402_VERSION,
    schemes: ["exact"],
    networks: [NETWORK],
    assets: [ASSET],
    directSettlement: true,
    mandateSupport: false,
    protocolFeeBps: 0,
    description: "SweePay s402 Demo API — Sui-native HTTP 402 payments",
  });
});

// ── Health check ──────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", protocol: "s402" }));

// ══════════════════════════════════════════════════════════════
// Start server
// ══════════════════════════════════════════════════════════════

export function startServer(port = PORT): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║  s402 Demo Server — Sui-native HTTP 402 Payments         ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Endpoints:                                              ║
║    GET /api/weather        FREE                          ║
║    GET /api/forecast       1,000 MIST (s402-gated)       ║
║    GET /api/alpha-signals  5,000 MIST (s402-gated)       ║
║    GET /.well-known/s402.json  Discovery                 ║
║                                                          ║
║  Network: Sui Testnet                                    ║
║  Protocol: s402 v${S402_VERSION}                                      ║
║  Port: ${port}                                              ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`);
      resolve(server);
    });
  });
}

// Run standalone
if (process.argv[1]?.endsWith("server.ts")) {
  startServer();
}
