/**
 * @sweefi/cli — AI agent payments on Sui.
 *
 * Design principles:
 *   1. Agents are the primary user — JSON-first output
 *   2. Zero stored state — env vars only, no config files
 *   3. Block until final — Sui's 400ms finality, no "pending" states
 *   4. The SDK does the work — handlers are thin wrappers
 *   5. Show the economics — gas costs in every response
 *
 * Commands:
 *   sweefi pay <recipient> <amount>          — one-shot payment
 *   sweefi pay-402 --url <URL>               — handle HTTP 402 automatically
 *   sweefi balance [address]                 — check wallet balance
 *   sweefi receipt <object-id>               — get payment receipt
 *   sweefi prepaid deposit <provider> <amt>  — open prepaid balance
 *   sweefi prepaid status <balance-id>       — check prepaid budget
 *   sweefi mandate create <agent> ...        — set spending caps
 *   sweefi mandate check <mandate-id>        — verify mandate
 *   sweefi mandate list [address]            — list active mandates
 *   sweefi prepaid list [address]            — list prepaid balances
 */

import { parseArgs } from "node:util";
import { createContext, CliError } from "./context.js";
import { outputError } from "./output.js";
import { pay } from "./commands/pay.js";
import { pay402 } from "./commands/pay-402.js";
import { balance } from "./commands/balance.js";
import { receipt } from "./commands/receipt.js";
import { prepaidDeposit, prepaidStatus, prepaidList } from "./commands/prepaid.js";
import { mandateCreate, mandateCheck, mandateList } from "./commands/mandate.js";
import { walletGenerate } from "./commands/wallet.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  // Extract command before parseArgs (parseArgs doesn't handle subcommands)
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];

  // Handle --version and --help before anything else
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`sweefi ${VERSION}\n`);
    return;
  }

  // Determine subcommand depth
  let fullCommand = command;
  let commandArgs = rawArgs.slice(1);
  if ((command === "prepaid" || command === "mandate" || command === "wallet") && commandArgs.length > 0 && !commandArgs[0].startsWith("-")) {
    fullCommand = `${command} ${commandArgs[0]}`;
    commandArgs = commandArgs.slice(1);
  }

  // Parse global flags from remaining args
  const { values: flags, positionals } = parseArgs({
    args: commandArgs,
    options: {
      network: { type: "string", short: "n" },
      human: { type: "boolean" },
      coin: { type: "string" },
      memo: { type: "string" },
      "dry-run": { type: "boolean" },
      url: { type: "string" },
      method: { type: "string" },
      body: { type: "string" },
      header: { type: "string", multiple: true },
      mandate: { type: "string" },
      registry: { type: "string" },
      rate: { type: "string" },
      "max-calls": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  // Narrow parseArgs types (strict: false returns string | boolean | undefined)
  const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  const bool = (v: string | boolean | undefined): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  const strArr = (v: (string | boolean)[] | undefined): string[] | undefined =>
    v?.filter((x): x is string => typeof x === "string");

  const ctx = createContext({ network: str(flags.network) });
  const commonFlags = {
    human: bool(flags.human),
    coin: str(flags.coin),
    memo: str(flags.memo),
    mandate: str(flags.mandate),
    registry: str(flags.registry),
    dryRun: bool(flags["dry-run"]),
  };

  switch (fullCommand) {
    case "pay":
      return pay(ctx, positionals, commonFlags);
    case "pay-402":
      return pay402(ctx, positionals, {
        url: str(flags.url),
        method: str(flags.method),
        body: str(flags.body),
        header: strArr(flags.header),
        human: bool(flags.human),
      });
    case "balance":
      return balance(ctx, positionals, { coin: str(flags.coin), human: bool(flags.human) });
    case "receipt":
      return receipt(ctx, positionals, { human: bool(flags.human) });
    case "prepaid deposit":
      return prepaidDeposit(ctx, positionals, {
        coin: str(flags.coin),
        rate: str(flags.rate),
        maxCalls: str(flags["max-calls"]),
        dryRun: bool(flags["dry-run"]),
        human: bool(flags.human),
      });
    case "prepaid status":
      return prepaidStatus(ctx, positionals, { human: bool(flags.human) });
    case "prepaid list":
      return prepaidList(ctx, positionals, { human: bool(flags.human) });
    case "mandate create":
      return mandateCreate(ctx, positionals, {
        coin: str(flags.coin),
        dryRun: bool(flags["dry-run"]),
        human: bool(flags.human),
      });
    case "mandate check":
      return mandateCheck(ctx, positionals, { human: bool(flags.human) });
    case "mandate list":
      return mandateList(ctx, positionals, { human: bool(flags.human) });
    case "wallet generate":
      return walletGenerate({ human: bool(flags.human) });
    default:
      outputError(fullCommand, "UNKNOWN_COMMAND", `Unknown command: "${fullCommand}"`, false, "Run sweefi --help for available commands");
      process.exit(1);
  }
}

function printHelp(): void {
  process.stdout.write(`sweefi ${VERSION} — AI agent payments on Sui

Usage: sweefi <command> [options]

Commands:
  pay <recipient> <amount> [--mandate <id> --registry <id>]  Make a payment
  pay-402 --url <URL>                         Handle HTTP 402 automatically
  balance [address]                           Check wallet balance
  receipt <object-id>                         Get payment receipt
  prepaid deposit <provider> <amount>         Open a prepaid balance
  prepaid status <balance-id>                 Check prepaid budget
  prepaid list [address]                      List prepaid balances
  mandate create <agent> <per-tx> <total> <expires>  Set spending caps
  mandate check <mandate-id>                  Verify mandate status
  mandate list [address]                      List active mandates
  wallet generate                             Generate a new keypair

Global flags:
  --network <testnet|mainnet|devnet>   Override SUI_NETWORK env var
  --coin <SUI|USDC|USDT>              Token type (default: SUI)
  --human                             Human-readable output (default: JSON)
  --dry-run                           Simulate without broadcasting
  -v, --version                       Show version
  -h, --help                          Show this help

Environment:
  SUI_PRIVATE_KEY      Wallet key (bech32 or base64) — required for payments
  SUI_NETWORK          testnet | mainnet | devnet (default: testnet)
  SUI_RPC_URL          Custom RPC endpoint (optional)
  SUI_PACKAGE_ID       Override contract package (optional)

Examples:
  sweefi pay 0xBob... 1.5 --coin SUI
  sweefi pay-402 --url https://api.example.com/premium
  sweefi balance
  sweefi prepaid deposit 0xProvider... 10 --rate 10000000
  sweefi mandate create 0xAgent... 1 50 7d
`);
}

/** Strip anything that could be key material from error messages. */
function sanitize(msg: string): string {
  return msg
    .replace(/suiprivkey1[a-z0-9]{50,}/gi, "[REDACTED]")
    .replace(/[A-Za-z0-9+/]{60,}={0,2}/g, "[REDACTED]");
}

/** Detect network/RPC errors from Sui client. */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|NetworkError/i.test(msg);
}

main().catch((err) => {
  const command = process.argv[2] ?? "unknown";

  if (err instanceof CliError) {
    outputError(command, err.code, err.message, err.retryable, err.suggestedAction, err.requiresHumanAction);
    process.exit(1);
  }

  // Network/RPC errors — retryable, agent can self-heal
  if (isNetworkError(err)) {
    outputError(command, "NETWORK_ERROR", "Sui RPC is unreachable or timed out", true, "Retry in 30 seconds. If the issue persists, check SUI_RPC_URL or try a different RPC endpoint.");
    process.exit(1);
  }

  // Unexpected error — sanitize in case a dependency leaks key material
  const msg = sanitize(err instanceof Error ? err.message : String(err));
  outputError(command, "INTERNAL_ERROR", msg, false, "This is a bug — please report it");
  process.exit(2);
});
