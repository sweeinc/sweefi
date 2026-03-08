/**
 * s402 Demo #2 — Facilitator-as-a-Service
 *
 * Orchestrates the full three-party demo:
 *   1. Starts the real @sweefi/facilitator as a separate process (Server B)
 *   2. Starts the resource provider API (Server A)
 *   3. Runs the autonomous agent
 *   4. Queries the facilitator's /settlements endpoint to show metering
 *   5. Cleans up
 *
 * This proves the SweeFi business model:
 *   - API providers delegate settlement (zero blockchain code)
 *   - Facilitators earn revenue via metering (settlement-as-a-service)
 *   - Agents pay seamlessly (don't know facilitators exist)
 *
 * Usage:
 *   cp .env.example .env   # add SUI_PRIVATE_KEY
 *   pnpm demo
 */

import { fork } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server-a.js";
import { runAgent } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════

const FACILITATOR_PORT = 4022;
const SERVER_PORT = 3402;
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY ?? "demo-facilitator-key-0123456789abcdef";
const FEE_MICRO_PERCENT = process.env.FEE_MICRO_PERCENT ?? "50000"; // 5%
const FEE_RECIPIENT = process.env.FEE_RECIPIENT ?? "";
const SWEEFI_PACKAGE_ID = process.env.SWEEFI_PACKAGE_ID ?? "";

// ══════════════════════════════════════════════════════════════
// Pretty logging
// ══════════════════════════════════════════════════════════════

const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function header(text: string) {
  console.log(`\n${C.cyan}${"─".repeat(60)}${C.reset}`);
  console.log(`${C.cyan}  ${C.bright}${text}${C.reset}`);
  console.log(`${C.cyan}${"─".repeat(60)}${C.reset}`);
}

// ══════════════════════════════════════════════════════════════
// Start facilitator as a child process
// ══════════════════════════════════════════════════════════════

function startFacilitator(): Promise<ReturnType<typeof fork>> {
  return new Promise((resolvePromise, reject) => {
    header("Phase 1: Starting Facilitator (Server B)");
    console.log(`  ${C.dim}Spawning @sweefi/facilitator as a separate process...${C.reset}`);

    const facilitatorEntry = resolve(__dirname, "../../packages/facilitator/src/index.ts");

    // Explicit env allowlist — never leak SUI_PRIVATE_KEY to the facilitator.
    // Includes system vars (TMPDIR, LANG, TERM) for cross-platform robustness.
    const child = fork(facilitatorEntry, [], {
      execArgv: ["--import", "tsx/esm"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        TERM: process.env.TERM,
        NODE_PATH: process.env.NODE_PATH,
        PORT: String(FACILITATOR_PORT),
        API_KEYS: FACILITATOR_API_KEY,
        FEE_MICRO_PERCENT: FEE_MICRO_PERCENT,
        ...(FEE_RECIPIENT ? { FEE_RECIPIENT } : {}),
        ...(SWEEFI_PACKAGE_ID ? { SWEEFI_PACKAGE_ID } : {}),
        LOG_LEVEL: "warn", // Quiet logs for demo — only warnings/errors
        NODE_ENV: "development",
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      // Suppress SWEEFI_PACKAGE_ID warning — the exact scheme used in this
      // demo does not need it (only escrow/stream/prepaid do)
      if (msg && !msg.includes("SWEEFI_PACKAGE_ID")) {
        console.error(`  ${C.red}[facilitator] ${msg}${C.reset}`);
      }
    });

    child.stdout?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  ${C.dim}[facilitator] ${msg}${C.reset}`);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start facilitator: ${err.message}`));
    });

    // Wait for the facilitator to be ready
    const checkReady = async (retries = 20): Promise<void> => {
      for (let i = 0; i < retries; i++) {
        try {
          const res = await fetch(`http://localhost:${FACILITATOR_PORT}/health`);
          if (res.ok) {
            console.log(`  ${C.green}✓${C.reset} Facilitator ready on port ${FACILITATOR_PORT} (PID: ${child.pid})`);
            resolvePromise(child);
            return;
          }
        } catch {
          // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      child.kill();
      reject(new Error("Facilitator failed to start within 10 seconds"));
    };

    checkReady();
  });
}

// ══════════════════════════════════════════════════════════════
// Query facilitator metering after demo
// ══════════════════════════════════════════════════════════════

async function showMeteringData() {
  header("Phase 4: Facilitator Metering Data");
  console.log(`  ${C.dim}Querying /settlements to show tracked revenue...${C.reset}\n`);

  try {
    const res = await fetch(`http://localhost:${FACILITATOR_PORT}/settlements`, {
      headers: { Authorization: `Bearer ${FACILITATOR_API_KEY}` },
    });

    if (!res.ok) {
      console.log(`  ${C.red}Could not fetch settlements: ${res.status}${C.reset}`);
      return;
    }

    const data = (await res.json()) as {
      totalSettled: string;
      count: number;
      records: Array<{ amount: string; network: string; txDigest: string; timestamp: number }>;
    };

    const feeRate = Number(FEE_MICRO_PERCENT);

    console.log(`  ${C.bright}Facilitator Revenue Report${C.reset}`);
    console.log(`  ${"─".repeat(45)}`);
    console.log(`  Total settled:    ${data.totalSettled} MIST`);
    console.log(`  Settlements:      ${data.count}`);
    console.log(`  Fee rate:         ${FEE_MICRO_PERCENT} micro-percent (${feeRate / 10000}%)`);

    if (data.records?.length > 0) {
      console.log(`\n  ${C.bright}Settlement Log:${C.reset}`);
      for (const record of data.records) {
        // Compute fee client-side — UsageTracker (Phase 1) stores amount only
        const fee = (BigInt(record.amount) * BigInt(feeRate)) / 1_000_000n;
        console.log(`    ${C.green}•${C.reset} ${record.amount} MIST → fee: ${fee.toString()} MIST`);
        console.log(`      ${C.dim}TX: ${record.txDigest}${C.reset}`);
        console.log(`      ${C.dim}https://suiscan.xyz/testnet/tx/${record.txDigest}${C.reset}`);
      }
    }

    // Compute total fee client-side from known rate + settlement amounts
    const totalFee = data.records?.reduce(
      (sum, r) => sum + (BigInt(r.amount) * BigInt(feeRate)) / 1_000_000n,
      0n,
    ) ?? 0n;

    console.log(`\n  ${C.bright}Revenue Model Preview:${C.reset}`);
    console.log(`  ${C.dim}The facilitator tracked ${data.count} settlements totaling${C.reset}`);
    console.log(`  ${C.dim}${data.totalSettled} MIST. At ${feeRate / 10000}% fee rate, the facilitator${C.reset}`);
    console.log(`  ${C.dim}metered ${totalFee.toString()} MIST in settlement fees.${C.reset}`);
    console.log(`  ${C.dim}Phase 1: off-chain metering (invoice manually).${C.reset}`);
    console.log(`  ${C.dim}Phase 2: on-chain fee splits via Move contracts (v0.2).${C.reset}`);

  } catch (error) {
    console.log(`  ${C.red}Error querying metering: ${error}${C.reset}`);
  }
}

// ══════════════════════════════════════════════════════════════
// Main orchestrator
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log(`
${C.bright}╔══════════════════════════════════════════════════════════╗
║        SweeFi Demo #2 — Facilitator-as-a-Service        ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Three-party s402 settlement:                            ║
║    Agent → Server A (API) → Server B (Facilitator) → Sui ║
║                                                          ║
║  Proves: settlement delegation, metering, revenue model  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝${C.reset}
`);

  let facilitatorProcess: ReturnType<typeof fork> | null = null;
  let apiServer: { close: () => void } | null = null;

  try {
    // Phase 1: Start facilitator (separate process)
    facilitatorProcess = await startFacilitator();

    // Phase 2: Start Server A (in-process)
    header("Phase 2: Starting Resource Provider (Server A)");
    apiServer = await startServer(SERVER_PORT);

    // Give everything a moment to stabilize
    await new Promise((r) => setTimeout(r, 500));

    // Phase 3: Run the agent
    header("Phase 3: Running Autonomous Agent");
    await runAgent();

    // Phase 4: Show facilitator metering data
    await showMeteringData();

  } finally {
    // Cleanup
    header("Cleanup");
    if (apiServer) {
      apiServer.close();
      console.log(`  ${C.dim}Server A stopped${C.reset}`);
    }
    if (facilitatorProcess) {
      facilitatorProcess.kill("SIGTERM");
      console.log(`  ${C.dim}Facilitator stopped (PID: ${facilitatorProcess.pid})${C.reset}`);
    }
    console.log(`\n${C.green}Demo complete.${C.reset}\n`);
  }
}

main().catch((err) => {
  console.error(`\n${C.red}Demo failed: ${err.message}${C.reset}`);
  process.exit(1);
});
