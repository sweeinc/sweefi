/**
 * s402 Autonomous Agent — Facilitator Settlement Demo
 *
 * Demonstrates the full three-party s402 flow:
 *   1. Agent has a funded Sui testnet wallet
 *   2. Agent hits API endpoints (doesn't know prices upfront)
 *   3. Gets 402 → auto-detects s402 → signs payment → retries
 *   4. Server A forwards payment to facilitator (Server B) for settlement
 *   5. Facilitator broadcasts to Sui testnet, meters the settlement
 *   6. Agent receives premium data
 *
 * The agent is identical to Demo #1 — it doesn't know or care that
 * a facilitator is involved. That's the point: the facilitator is
 * invisible to the agent. Only Server A knows about it.
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { s402Client, S402_VERSION } from "s402";
import { ExactSuiClientScheme, toClientSuiSigner } from "@sweefi/sui";
import { wrapFetchWithS402 } from "@sweefi/server";

// ══════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════

const API_BASE = process.env.API_BASE ?? "http://localhost:3402";
const NETWORK = "sui:testnet";

// ══════════════════════════════════════════════════════════════
// Pretty logging
// ══════════════════════════════════════════════════════════════

const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function banner(text: string) {
  const line = "═".repeat(58);
  console.log(`\n${C.cyan}╔${line}╗${C.reset}`);
  console.log(`${C.cyan}║${C.bright}  ${text.padEnd(56)}${C.reset}${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚${line}╝${C.reset}`);
}

function step(num: number, text: string) {
  console.log(`\n${C.magenta}[${"▸".repeat(num)}]${C.reset} ${C.bright}${text}${C.reset}`);
}

function info(key: string, value: string) {
  console.log(`  ${C.dim}${key}:${C.reset} ${value}`);
}

function success(text: string) {
  console.log(`  ${C.green}✓${C.reset} ${text}`);
}

function paid(text: string) {
  console.log(`  ${C.yellow}💰${C.reset} ${text}`);
}

// ══════════════════════════════════════════════════════════════
// Agent
// ══════════════════════════════════════════════════════════════

export async function runAgent(privateKey?: string) {
  banner("s402 Agent — Facilitator Settlement Demo");

  // ── Setup wallet ────────────────────────────────────────────
  const key = privateKey ?? process.env.SUI_PRIVATE_KEY;
  if (!key) {
    throw new Error("SUI_PRIVATE_KEY env var is required (bech32 suiprivkey1... or base64). Get testnet SUI: https://faucet.sui.io");
  }

  const keypair = Ed25519Keypair.fromSecretKey(key);
  const address = keypair.getPublicKey().toSuiAddress();
  const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
  const signer = toClientSuiSigner(keypair, suiClient);

  step(1, "Agent wallet initialized");
  info("Address", address);
  info("Network", NETWORK);

  // Check balance
  const balance = await suiClient.getBalance({ owner: address });
  const balanceSui = Number(balance.totalBalance) / 1e9;
  info("Balance", `${balanceSui.toFixed(4)} SUI (${balance.totalBalance} MIST)`);

  if (BigInt(balance.totalBalance) < 100_000n) {
    throw new Error("Need at least 0.0001 SUI. Get testnet SUI at https://faucet.sui.io");
  }

  // ── Create s402 client ──────────────────────────────────────
  const client = new s402Client();
  client.register(NETWORK, new ExactSuiClientScheme(signer));

  const paidFetch = wrapFetchWithS402(globalThis.fetch, client);

  step(2, "s402 client ready (exact scheme registered)");
  info("Protocol", `s402 v${S402_VERSION}`);
  info("Schemes", "exact (auto-pay on 402)");

  // ── Task 1: Free endpoint ──────────────────────────────────
  step(3, "Fetching FREE weather data...");

  const weatherRes = await paidFetch(`${API_BASE}/api/weather`);
  const weather = (await weatherRes.json()) as Record<string, unknown>;

  info("Status", `${weatherRes.status} (no payment needed)`);
  info("Temperature", `${weather.temperature}°${weather.unit}`);
  info("Condition", weather.condition as string);
  success("Free data retrieved — no s402 interaction");

  // ── Task 2: Premium endpoint (10,000 MIST via facilitator) ─
  step(4, "Fetching PREMIUM 7-day forecast (settled via facilitator)...");
  console.log(`  ${C.dim}Agent doesn't know a facilitator exists — Server A handles it${C.reset}`);

  const forecastStart = Date.now();
  const forecastRes = await paidFetch(`${API_BASE}/api/forecast`);
  const forecastTime = Date.now() - forecastStart;

  if (forecastRes.ok) {
    const forecast = (await forecastRes.json()) as Record<string, unknown>;
    paid(`AUTO-PAID 10,000 MIST → settled via facilitator (${forecastTime}ms)`);
    info("Model", forecast.model as string);
    info("Settled Via", forecast.settledVia as string);

    const days = forecast.forecast as Array<{ day: string; high: number; low: number; condition: string }>;
    console.log(`\n  ${C.bright}7-Day Forecast:${C.reset}`);
    for (const day of days) {
      console.log(`    ${day.day}: ${day.high}°/${day.low}° ${day.condition}`);
    }

    // Check for settlement receipt
    const settlementHeader = forecastRes.headers.get("payment-response");
    if (settlementHeader) {
      try {
        const receipt = JSON.parse(atob(settlementHeader));
        info("TX Digest", receipt.txDigest);
        info("Explorer", `https://suiscan.xyz/testnet/tx/${receipt.txDigest}`);
      } catch { /* ignore parse errors */ }
    }
    success("Premium forecast retrieved — facilitator settled on Sui testnet!");
  } else {
    console.error(`  ${C.red}Failed: ${forecastRes.status} ${await forecastRes.text()}${C.reset}`);
  }

  // ── Task 3: Premium endpoint (50,000 MIST via facilitator) ─
  step(5, "Fetching PREMIUM AI trading signals (higher price, same facilitator)...");

  const signalsStart = Date.now();
  const signalsRes = await paidFetch(`${API_BASE}/api/alpha-signals`);
  const signalsTime = Date.now() - signalsStart;

  if (signalsRes.ok) {
    const signals = (await signalsRes.json()) as Record<string, unknown>;
    paid(`AUTO-PAID 50,000 MIST → settled via facilitator (${signalsTime}ms)`);
    info("Model", signals.model as string);
    info("Settled Via", signals.settledVia as string);

    const items = signals.signals as Array<{ asset: string; direction: string; confidence: number; entry: number; target: number }>;
    console.log(`\n  ${C.bright}Trading Signals:${C.reset}`);
    for (const s of items) {
      const arrow = s.direction === "long" ? "↑" : "↓";
      const color = s.direction === "long" ? C.green : C.red;
      console.log(
        `    ${color}${arrow} ${s.asset}${C.reset} ` +
        `${s.direction.toUpperCase()} @ ${s.entry} → ${s.target} ` +
        `(${(s.confidence * 100).toFixed(0)}% conf)`,
      );
    }

    const settlementHeader = signalsRes.headers.get("payment-response");
    if (settlementHeader) {
      try {
        const receipt = JSON.parse(atob(settlementHeader));
        info("TX Digest", receipt.txDigest);
        info("Explorer", `https://suiscan.xyz/testnet/tx/${receipt.txDigest}`);
      } catch { /* ignore parse errors */ }
    }
    success("AI trading signals retrieved — facilitator settled on Sui testnet!");
  } else {
    console.error(`  ${C.red}Failed: ${signalsRes.status} ${await signalsRes.text()}${C.reset}`);
  }

  // ── Summary ─────────────────────────────────────────────────
  const finalBalance = await suiClient.getBalance({ owner: address });
  const spent = BigInt(balance.totalBalance) - BigInt(finalBalance.totalBalance);

  banner("Facilitator Settlement Demo Complete");
  console.log(`
  ${C.bright}Three-Party Architecture:${C.reset}
  ${C.green}1.${C.reset} Agent hit 3 API endpoints (1 free, 2 premium)
  ${C.green}2.${C.reset} Premium endpoints returned HTTP 402 with s402 requirements
  ${C.green}3.${C.reset} Agent's s402 client auto-signed payment transactions
  ${C.green}4.${C.reset} Server A forwarded payments to the facilitator (Server B)
  ${C.green}5.${C.reset} Facilitator verified signatures + broadcast to Sui testnet
  ${C.green}6.${C.reset} Facilitator metered each settlement (usage tracking)
  ${C.green}7.${C.reset} Agent received premium data — never knew about the facilitator

  ${C.bright}Key Insight:${C.reset}
  ${C.dim}Server A has ZERO blockchain imports. It delegates all settlement
  to the facilitator via a single HTTP call. This is SweeFi's business
  model: facilitators earn revenue by providing settlement-as-a-service.${C.reset}

  ${C.bright}Financials:${C.reset}
  Starting balance: ${balanceSui.toFixed(4)} SUI
  Ending balance:   ${(Number(finalBalance.totalBalance) / 1e9).toFixed(4)} SUI
  Total spent:      ${spent.toString()} MIST (${(Number(spent) / 1e9).toFixed(6)} SUI)
  Gas included:     Yes (agent pays gas as part of each PTB)
`);
}

// Run standalone
if (process.argv[1]?.endsWith("agent.ts")) {
  runAgent().catch(console.error);
}
