/**
 * @sweefi/cli v0.3.0 — AI agent payments on Sui.
 *
 * Design principles:
 *   1. Agents are the primary user — JSON-first output
 *   2. Zero stored state — env vars only, no config files
 *   3. Block until final — Sui's 400ms finality, no "pending" states
 *   4. The SDK does the work — handlers are thin wrappers
 *   5. Show the economics — gas costs in every response
 *
 * v0.2 additions:
 *   - Idempotent payments via --idempotency-key (on-chain memo dedup)
 *   - meta block in every response (network, timing, requestId, gas)
 *   - sweefi schema — machine-readable command manifest for MCP/tool-use
 *   - sweefi doctor — setup diagnostics
 *   - Enhanced --dry-run with affordability checks
 *   - TX_FAILED split into TX_OUT_OF_GAS / TX_OBJECT_CONFLICT / TX_EXECUTION_ERROR
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
 *   sweefi doctor                            — setup diagnostics
 *   sweefi schema                            — machine-readable manifest
 */

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createContext, CliError, debug, sanitize, isNetworkError } from "./context.js";
import { VERSION, outputError, createRequestContext, type RequestContext } from "./output.js";
import { validateIdempotencyKey } from "./idempotency.js";
import { pay } from "./commands/pay.js";
import { pay402 } from "./commands/pay-402.js";
import { balance } from "./commands/balance.js";
import { receipt } from "./commands/receipt.js";
import { prepaidDeposit, prepaidStatus, prepaidList } from "./commands/prepaid.js";
import { mandateCreate, mandateCheck, mandateList } from "./commands/mandate.js";
import { walletGenerate } from "./commands/wallet.js";
import { doctor } from "./commands/doctor.js";
import { schema } from "./commands/schema.js";

// Module-level error context — populated as main() progresses, read by the
// .catch() handler which runs outside main()'s scope and cannot close over its locals.
let _command: string = process.argv[2] ?? "unknown";
let _reqCtx: RequestContext | undefined;
let _isHuman = false;

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

  // Schema command emits raw JSON (not wrapped in envelope)
  if (command === "schema") {
    schema();
    return;
  }

  // Determine subcommand depth
  let fullCommand = command;
  let commandArgs = rawArgs.slice(1);
  if ((command === "prepaid" || command === "mandate" || command === "wallet") && commandArgs.length > 0 && !commandArgs[0].startsWith("-")) {
    fullCommand = `${command} ${commandArgs[0]}`;
    commandArgs = commandArgs.slice(1);
  }
  _command = fullCommand;

  // Parse global flags from remaining args
  const { values: flags, positionals } = parseArgs({
    args: commandArgs,
    options: {
      network: { type: "string", short: "n" },
      human: { type: "boolean" },
      coin: { type: "string" },
      memo: { type: "string" },
      json: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "idempotency-key": { type: "string" },
      url: { type: "string" },
      method: { type: "string" },
      body: { type: "string" },
      header: { type: "string", multiple: true },
      mandate: { type: "string" },
      registry: { type: "string" },
      rate: { type: "string" },
      "max-calls": { type: "string" },
      verbose: { type: "boolean" },
      timeout: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  // Narrow parseArgs types (strict: false returns string | boolean | undefined)
  const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  const bool = (v: string | boolean | undefined): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  const strArr = (v: (string | boolean)[] | undefined): string[] | undefined =>
    v?.filter((x): x is string => typeof x === "string");

  // Resolve output mode early — needed before any outputError calls
  const isHuman = bool(flags.json) ? false : (bool(flags.human) ?? false);
  _isHuman = isHuman;

  const timeoutRaw = str(flags.timeout);
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
  if (timeoutMs !== undefined && (Number.isNaN(timeoutMs) || timeoutMs <= 0)) {
    outputError(_command, "INVALID_VALUE", `Invalid --timeout value: "${timeoutRaw}"`, false, "Provide a positive number in milliseconds (e.g., --timeout 30000)", false, undefined, undefined, _isHuman);
    process.exit(1);
  }

  const ctx = createContext({ network: str(flags.network), verbose: bool(flags.verbose), timeout: timeoutMs });
  const reqCtx = createRequestContext(ctx.network);
  _reqCtx = reqCtx;

  // Validate idempotency key if provided
  const rawIdempotencyKey = str(flags["idempotency-key"]);
  const idempotencyKey = rawIdempotencyKey ? validateIdempotencyKey(rawIdempotencyKey) : undefined;
  const effectiveIdempotencyKey =
    (fullCommand === "pay" || fullCommand === "pay-402") && isHuman && !idempotencyKey && !bool(flags["dry-run"])
      ? randomUUID()
      : idempotencyKey;

  debug(ctx, "command:", fullCommand, "network:", ctx.network, "timeout:", ctx.timeoutMs);

  const commonFlags = {
    human: isHuman,
    coin: str(flags.coin),
    memo: str(flags.memo),
    mandate: str(flags.mandate),
    registry: str(flags.registry),
    dryRun: bool(flags["dry-run"]),
    idempotencyKey: effectiveIdempotencyKey,
  };

  switch (fullCommand) {
    case "pay":
      return pay(ctx, positionals, commonFlags, reqCtx);
    case "pay-402":
      return pay402(ctx, positionals, {
        url: str(flags.url),
        method: str(flags.method),
        body: str(flags.body),
        header: strArr(flags.header),
        human: isHuman,
        idempotencyKey: effectiveIdempotencyKey,
        dryRun: bool(flags["dry-run"]),
      }, reqCtx);
    case "balance":
      return balance(ctx, positionals, { coin: str(flags.coin), human: isHuman }, reqCtx);
    case "receipt":
      return receipt(ctx, positionals, { human: isHuman }, reqCtx);
    case "prepaid deposit":
      return prepaidDeposit(ctx, positionals, {
        coin: str(flags.coin),
        rate: str(flags.rate),
        maxCalls: str(flags["max-calls"]),
        dryRun: bool(flags["dry-run"]),
        human: isHuman,
      }, reqCtx);
    case "prepaid status":
      return prepaidStatus(ctx, positionals, { human: isHuman }, reqCtx);
    case "prepaid list":
      return prepaidList(ctx, positionals, { human: isHuman }, reqCtx);
    case "mandate create":
      return mandateCreate(ctx, positionals, {
        coin: str(flags.coin),
        dryRun: bool(flags["dry-run"]),
        human: isHuman,
      }, reqCtx);
    case "mandate check":
      return mandateCheck(ctx, positionals, { human: isHuman }, reqCtx);
    case "mandate list":
      return mandateList(ctx, positionals, { human: isHuman }, reqCtx);
    case "wallet generate":
      return walletGenerate({ human: isHuman }, reqCtx);
    case "doctor":
      return doctor(ctx, { human: isHuman }, reqCtx);
    default:
      outputError(fullCommand, "UNKNOWN_COMMAND", `Unknown command: "${fullCommand}"`, false, "Run sweefi --help for available commands", false, reqCtx, undefined, isHuman);
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
  doctor                                      Run setup diagnostics
  schema                                      Machine-readable command manifest

Global flags:
  --network <testnet|mainnet|devnet>   Override SUI_NETWORK env var
  --coin <SUI|USDC|USDT>              Token type (default: SUI)
  --human                             Human-readable output (default: JSON)
  --json                              Force JSON output (overrides --human)
  --dry-run                           Simulate without broadcasting
  --idempotency-key <uuid>            Dedup key for crash-safe payments
  --verbose                           Debug output on stderr
  --timeout <ms>                      RPC timeout in milliseconds (default: 30000)
  -v, --version                       Show version
  -h, --help                          Show this help

Environment:
  SUI_PRIVATE_KEY      Wallet key (bech32 or base64) — required for payments
  SUI_NETWORK          testnet | mainnet | devnet (default: testnet)
  SUI_RPC_URL          Custom RPC endpoint (optional)
  SUI_PACKAGE_ID       Override contract package (optional)

Examples:
  sweefi pay 0xBob... 1.5 --coin SUI --idempotency-key $(uuidgen)
  sweefi pay-402 --url https://api.example.com/premium
  sweefi balance
  sweefi prepaid deposit 0xProvider... 10 --rate 10000000
  sweefi mandate create 0xAgent... 1 50 7d
  sweefi doctor
  sweefi schema
`);
}

main().catch((err) => {
  if (err instanceof CliError) {
    outputError(_command, err.code, sanitize(err.message), err.retryable, err.suggestedAction, err.requiresHumanAction, _reqCtx, undefined, _isHuman);
    process.exit(1);
  }

  // Network/RPC errors — retryable, agent can self-heal
  if (isNetworkError(err)) {
    outputError(_command, "NETWORK_ERROR", "Sui RPC is unreachable or timed out", true, "Retry in 30 seconds. If the issue persists, check SUI_RPC_URL or try a different RPC endpoint.", false, _reqCtx, 30_000, _isHuman);
    process.exit(1);
  }

  // Unexpected error — sanitize in case a dependency leaks key material
  const msg = sanitize(err instanceof Error ? err.message : String(err));
  outputError(_command, "INTERNAL_ERROR", msg, false, "This is a bug — please report it", false, _reqCtx, undefined, _isHuman);
  process.exit(2);
});
