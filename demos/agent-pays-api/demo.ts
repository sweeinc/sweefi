/**
 * s402 Agent Demo — Full E2E demonstration
 *
 * Starts the s402 server, then runs the autonomous agent.
 * Shows the complete flow: API → 402 → auto-pay → data.
 *
 * Usage:
 *   cp .env.example .env   # add your testnet private key
 *   pnpm demo              # .env loaded automatically
 *
 * Requirements:
 *   - Funded Sui testnet wallet (need ~0.01 SUI for gas + payments)
 *   - Get testnet SUI: https://faucet.sui.io
 */

import { startServer } from "./server.js";
import { runAgent } from "./agent.js";

async function main() {
  console.log("Starting s402 agent commerce demo...\n");

  // Start server
  const server = await startServer(3402);

  // Give server a moment to be fully ready
  await new Promise((r) => setTimeout(r, 500));

  try {
    // Run the agent
    await runAgent();
  } finally {
    // Cleanup
    server.close();
    console.log("\nServer stopped. Demo complete.");
  }
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
