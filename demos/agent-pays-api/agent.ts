/**
 * s402 Autonomous Agent — AI agent that auto-pays for API access
 *
 * Demonstrates the s402 agent commerce flow:
 *   1. Agent has a funded Sui testnet wallet
 *   2. Agent hits API endpoints (doesn't know prices upfront)
 *   3. Gets 402 → auto-detects s402 protocol → signs payment → retries
 *   4. Gets premium data back → processes it
 *
 * This is the future of agent commerce: APIs monetize via HTTP 402,
 * agents pay with crypto, no API keys or subscriptions needed.
 *
 * Usage:
 *   cp .env.example .env   # add your testnet private key
 *   pnpm agent             # .env loaded automatically
 *   # or via demo.ts which starts both server + agent
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { fromBase64 } from "@mysten/sui/utils";
import { s402Client, S402_VERSION } from "s402";
import { ExactSuiClientScheme, toClientSuiSigner } from "@sweepay/sui";
import { wrapFetchWithS402 } from "./s402-fetch-local.js";

// ══════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════

const API_BASE = process.env.API_BASE ?? "http://localhost:3402";
const NETWORK = "sui:testnet";

// ══════════════════════════════════════════════════════════════
// Pretty logging
// ══════════════════════════════════════════════════════════════

const COLORS = {
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
  console.log(`\n${COLORS.cyan}╔${line}╗${COLORS.reset}`);
  console.log(`${COLORS.cyan}║${COLORS.bright}  ${text.padEnd(56)}${COLORS.reset}${COLORS.cyan}║${COLORS.reset}`);
  console.log(`${COLORS.cyan}╚${line}╝${COLORS.reset}`);
}

function step(num: number, text: string) {
  console.log(`\n${COLORS.magenta}[${"▸".repeat(num)}]${COLORS.reset} ${COLORS.bright}${text}${COLORS.reset}`);
}

function info(key: string, value: string) {
  console.log(`  ${COLORS.dim}${key}:${COLORS.reset} ${value}`);
}

function success(text: string) {
  console.log(`  ${COLORS.green}✓${COLORS.reset} ${text}`);
}

function paid(text: string) {
  console.log(`  ${COLORS.yellow}💰${COLORS.reset} ${text}`);
}

// ══════════════════════════════════════════════════════════════
// Agent
// ══════════════════════════════════════════════════════════════

export async function runAgent(privateKey?: string) {
  banner("s402 Autonomous Agent — AI Commerce Demo");

  // ── Setup wallet ────────────────────────────────────────────
  const key = privateKey ?? process.env.SUI_PRIVATE_KEY;
  if (!key) {
    console.error(`${COLORS.red}ERROR: Set SUI_PRIVATE_KEY env var (base64 Ed25519 key)${COLORS.reset}`);
    console.error("Get testnet SUI: https://faucet.sui.io");
    process.exit(1);
  }

  const keypair = Ed25519Keypair.fromSecretKey(fromBase64(key));
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
    console.error(`${COLORS.red}ERROR: Need at least 0.0001 SUI. Get testnet SUI at https://faucet.sui.io${COLORS.reset}`);
    process.exit(1);
  }

  // ── Create s402 client ──────────────────────────────────────
  const client = new s402Client();
  client.register(NETWORK, new ExactSuiClientScheme(signer));

  const paidFetch = wrapFetchWithS402(globalThis.fetch, client);

  step(2, "s402 client ready (exact scheme registered)");
  info("Protocol", `s402 v${S402_VERSION}`);
  info("Schemes", "exact (auto-pay on 402)");

  // ── Task 1: Free endpoint (no payment needed) ──────────────
  step(3, "Fetching FREE weather data...");

  const weatherRes = await paidFetch(`${API_BASE}/api/weather`);
  const weather = await weatherRes.json();

  info("Status", `${weatherRes.status} (no payment needed)`);
  info("Temperature", `${weather.temperature}°${weather.unit}`);
  info("Condition", weather.condition);
  success("Free data retrieved — no s402 interaction");

  // ── Task 2: Premium endpoint (auto-pays 1,000 MIST) ────────
  step(4, "Fetching PREMIUM 7-day forecast (agent doesn't know the price)...");
  console.log(`  ${COLORS.dim}The agent will discover the price via 402 response${COLORS.reset}`);

  const forecastStart = Date.now();
  const forecastRes = await paidFetch(`${API_BASE}/api/forecast`);
  const forecastTime = Date.now() - forecastStart;

  if (forecastRes.ok) {
    const forecast = await forecastRes.json();
    paid(`AUTO-PAID 1,000 MIST → received premium forecast (${forecastTime}ms)`);
    info("Days", `${forecast.forecast.length}`);
    info("Model", forecast.model);
    info("Confidence", `${(forecast.confidence * 100).toFixed(0)}%`);

    // Show the forecast
    console.log(`\n  ${COLORS.bright}7-Day Forecast:${COLORS.reset}`);
    for (const day of forecast.forecast) {
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
    success("Premium forecast retrieved via s402 auto-payment!");
  } else {
    console.error(`  ${COLORS.red}Failed: ${forecastRes.status}${COLORS.reset}`);
  }

  // ── Task 3: Premium endpoint (auto-pays 5,000 MIST) ────────
  step(5, "Fetching PREMIUM AI trading signals (higher price)...");

  const signalsStart = Date.now();
  const signalsRes = await paidFetch(`${API_BASE}/api/alpha-signals`);
  const signalsTime = Date.now() - signalsStart;

  if (signalsRes.ok) {
    const signals = await signalsRes.json();
    paid(`AUTO-PAID 5,000 MIST → received AI signals (${signalsTime}ms)`);
    info("Signals", `${signals.signals.length}`);
    info("Model", signals.model);

    console.log(`\n  ${COLORS.bright}Trading Signals:${COLORS.reset}`);
    for (const s of signals.signals) {
      const arrow = s.direction === "long" ? "↑" : "↓";
      const color = s.direction === "long" ? COLORS.green : COLORS.red;
      console.log(
        `    ${color}${arrow} ${s.asset}${COLORS.reset} ` +
        `${s.direction.toUpperCase()} @ ${s.entry} → ${s.target} ` +
        `(${(s.confidence * 100).toFixed(0)}% conf)`
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
    success("AI trading signals retrieved via s402 auto-payment!");
  } else {
    console.error(`  ${COLORS.red}Failed: ${signalsRes.status}${COLORS.reset}`);
  }

  // ── Summary ─────────────────────────────────────────────────
  const finalBalance = await suiClient.getBalance({ owner: address });
  const spent = BigInt(balance.totalBalance) - BigInt(finalBalance.totalBalance);

  banner("Agent Demo Complete");
  console.log(`
  ${COLORS.bright}What happened:${COLORS.reset}
  ${COLORS.green}1.${COLORS.reset} Agent hit 3 API endpoints (1 free, 2 premium)
  ${COLORS.green}2.${COLORS.reset} Premium endpoints returned HTTP 402 with s402 requirements
  ${COLORS.green}3.${COLORS.reset} Agent's s402 client auto-detected the protocol
  ${COLORS.green}4.${COLORS.reset} Signed payment transactions with Sui testnet wallet
  ${COLORS.green}5.${COLORS.reset} Retried requests with X-PAYMENT header
  ${COLORS.green}6.${COLORS.reset} Server verified + settled payments on-chain
  ${COLORS.green}7.${COLORS.reset} Agent received premium data

  ${COLORS.bright}Financials:${COLORS.reset}
  Starting balance: ${balanceSui.toFixed(4)} SUI
  Ending balance:   ${(Number(finalBalance.totalBalance) / 1e9).toFixed(4)} SUI
  Total spent:      ${spent.toString()} MIST (${(Number(spent) / 1e9).toFixed(6)} SUI)

  ${COLORS.bright}The future of agent commerce:${COLORS.reset}
  ${COLORS.dim}No API keys. No subscriptions. No OAuth.
  Just HTTP 402 + crypto payments. The agent pays, the API serves.
  This is s402 on Sui — trustless, atomic, sub-second finality.${COLORS.reset}
`);
}

// Run standalone
if (process.argv[1]?.endsWith("agent.ts")) {
  runAgent().catch(console.error);
}
