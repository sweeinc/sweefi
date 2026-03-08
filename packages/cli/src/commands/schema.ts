/**
 * sweefi schema — Machine-readable command manifest.
 *
 * Emits a JSON manifest of all commands, arguments, types, and valid values.
 * This enables MCP tool registration, LLM function-calling schema generation,
 * and umbrella CLI auto-discovery.
 */

import { VERSION } from "../output.js";

interface ArgDef {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface FlagDef {
  name: string;
  type: string;
  required?: boolean;
  requiredWhen?: string;
  default?: unknown;
  description: string;
}

interface ErrorCodeDef {
  code: string;
  retryable: boolean;
  requiresHuman?: boolean;
  description: string;
}

interface EnvVarDef {
  name: string;
  required: boolean;
  description: string;
}

interface CommandDef {
  name: string;
  description: string;
  args: ArgDef[];
  flags: FlagDef[];
}

interface Schema {
  cli: string;
  version: string;
  globalFlags: FlagDef[];
  envVars: EnvVarDef[];
  commands: CommandDef[];
  errorCodes: ErrorCodeDef[];
}

function buildSchema(): Schema {
  return {
    cli: "sweefi",
    version: VERSION,
    globalFlags: [
      { name: "network", type: "string", default: "testnet", description: "Sui network (testnet, mainnet, devnet). Overrides SUI_NETWORK env var." },
      { name: "human", type: "boolean", default: false, description: "Human-readable output instead of JSON envelope" },
      { name: "json", type: "boolean", default: false, description: "Force JSON output (overrides --human)" },
      { name: "timeout", type: "number", default: 30000, description: "RPC timeout in milliseconds" },
      { name: "verbose", type: "boolean", default: false, description: "Debug output on stderr" },
    ],
    envVars: [
      { name: "SUI_PRIVATE_KEY", required: true, description: "Wallet key (bech32 suiprivkey1... or base64). Required for any transaction." },
      { name: "SUI_NETWORK", required: false, description: "Default network: testnet | mainnet | devnet" },
      { name: "SUI_RPC_URL", required: false, description: "Custom RPC endpoint (overrides default for network)" },
      { name: "SUI_PACKAGE_ID", required: false, description: "Override deployed contract package ID" },
    ],
    commands: [
      {
        name: "pay",
        description: "Execute a payment on Sui",
        args: [
          { name: "recipient", type: "string", required: true, description: "Sui address (0x...)" },
          { name: "amount", type: "number", required: true, description: "Amount in display units (e.g., 1.5 = 1.5 SUI)" },
        ],
        flags: [
          { name: "coin", type: "string", default: "SUI", description: "Token to pay with (SUI, USDC, USDT)" },
          { name: "idempotency-key", type: "string", required: false, requiredWhen: "JSON output mode (default). Auto-generated in --human mode.", description: "UUID for dedup — prevents double-spend on crash/retry" },
          { name: "memo", type: "string", description: "On-chain memo text" },
          { name: "mandate", type: "string", description: "Mandate object ID for delegated payments" },
          { name: "registry", type: "string", description: "Registry object ID (required with --mandate)" },
          { name: "dry-run", type: "boolean", default: false, description: "Simulate without executing — includes affordability check" },
        ],
      },
      {
        name: "pay-402",
        description: "Handle HTTP 402 Payment Required automatically via s402 protocol",
        args: [],
        flags: [
          { name: "url", type: "string", required: true, description: "URL to fetch" },
          { name: "method", type: "string", default: "GET", description: "HTTP method" },
          { name: "body", type: "string", description: "Request body" },
          { name: "header", type: "string[]", description: "Request headers (K: V format, repeatable)" },
          { name: "idempotency-key", type: "string", required: false, requiredWhen: "JSON output mode (default). Auto-generated in --human mode.", description: "UUID for dedup — prevents double-spend on crash/retry" },
          { name: "dry-run", type: "boolean", default: false, description: "Probe URL and show payment requirements without executing payment" },
        ],
      },
      {
        name: "balance",
        description: "Check wallet balance on Sui",
        args: [
          { name: "address", type: "string", required: false, description: "Sui address (defaults to own wallet)" },
        ],
        flags: [
          { name: "coin", type: "string", default: "SUI", description: "Token type" },
        ],
      },
      {
        name: "receipt",
        description: "Fetch an on-chain payment receipt by object ID",
        args: [
          { name: "object-id", type: "string", required: true, description: "PaymentReceipt object ID" },
        ],
        flags: [],
      },
      {
        name: "prepaid deposit",
        description: "Open a prepaid balance for API consumption",
        args: [
          { name: "provider", type: "string", required: true, description: "Provider Sui address" },
          { name: "amount", type: "number", required: true, description: "Deposit amount in display units" },
        ],
        flags: [
          { name: "coin", type: "string", default: "SUI", description: "Token type" },
          { name: "rate", type: "string", description: "Rate per call in base units" },
          { name: "max-calls", type: "string", description: "Maximum call count (default: unlimited)" },
          { name: "dry-run", type: "boolean", default: false, description: "Simulate without executing" },
        ],
      },
      {
        name: "prepaid status",
        description: "Check prepaid balance status",
        args: [
          { name: "balance-id", type: "string", required: true, description: "PrepaidBalance object ID" },
        ],
        flags: [],
      },
      {
        name: "prepaid list",
        description: "List prepaid balances owned by an address",
        args: [
          { name: "address", type: "string", required: false, description: "Sui address (defaults to own wallet)" },
        ],
        flags: [],
      },
      {
        name: "mandate create",
        description: "Create a spending mandate (human delegates to agent)",
        args: [
          { name: "agent", type: "string", required: true, description: "Agent Sui address" },
          { name: "max-per-tx", type: "number", required: true, description: "Per-transaction cap in display units" },
          { name: "max-total", type: "number", required: true, description: "Lifetime spending cap in display units" },
          { name: "expires-in", type: "string", required: true, description: "Duration (e.g., 7d, 24h, 30m)" },
        ],
        flags: [
          { name: "coin", type: "string", default: "SUI", description: "Token type" },
          { name: "dry-run", type: "boolean", default: false, description: "Simulate without executing" },
        ],
      },
      {
        name: "mandate check",
        description: "Verify mandate status and remaining budget",
        args: [
          { name: "mandate-id", type: "string", required: true, description: "Mandate object ID" },
        ],
        flags: [],
      },
      {
        name: "mandate list",
        description: "List active mandates owned by an address",
        args: [
          { name: "address", type: "string", required: false, description: "Sui address (defaults to own wallet)" },
        ],
        flags: [],
      },
      {
        name: "wallet generate",
        description: "Generate a new Ed25519 keypair for Sui",
        args: [],
        flags: [],
      },
      {
        name: "doctor",
        description: "Run setup diagnostics — checks wallet, network, RPC, package ID",
        args: [],
        flags: [],
      },
      {
        name: "schema",
        description: "Emit machine-readable JSON manifest of all commands",
        args: [],
        flags: [],
      },
    ],
    errorCodes: [
      // Input validation
      { code: "MISSING_ARGS", retryable: false, description: "Required arguments not provided" },
      { code: "INVALID_AMOUNT", retryable: false, description: "Amount is not a valid positive number" },
      { code: "INVALID_ADDRESS", retryable: false, description: "Not a valid Sui address (0x + 64 hex chars)" },
      { code: "INVALID_OBJECT_ID", retryable: false, description: "Not a valid Sui object ID" },
      { code: "INVALID_DURATION", retryable: false, description: "Duration format invalid (use 7d, 24h, 30m)" },
      { code: "INVALID_VALUE", retryable: false, description: "Flag value is invalid" },
      { code: "INVALID_URL", retryable: false, description: "URL is malformed or uses unsupported scheme" },
      { code: "INVALID_NETWORK", retryable: false, description: "Unknown network (use testnet, mainnet, devnet)" },
      { code: "INVALID_MANDATE", retryable: false, description: "Mandate parameters are inconsistent" },
      // Auth / wallet
      { code: "NO_WALLET", retryable: false, description: "SUI_PRIVATE_KEY not set or unreadable" },
      { code: "NO_ADDRESS", retryable: false, description: "No address provided and no wallet configured" },
      // Idempotency
      { code: "IDEMPOTENCY_KEY_REQUIRED", retryable: false, description: "JSON mode requires --idempotency-key for pay and pay-402" },
      { code: "IDEMPOTENCY_CONFLICT", retryable: false, description: "Key already used with different recipient/amount" },
      // Transaction execution
      { code: "TX_OUT_OF_GAS", retryable: true, description: "Transaction ran out of gas" },
      { code: "TX_OBJECT_CONFLICT", retryable: true, description: "Concurrent object access (transient)" },
      { code: "TX_EXECUTION_ERROR", retryable: false, description: "Transaction failed on-chain" },
      // Move abort codes (on-chain contract errors)
      { code: "INSUFFICIENT_PAYMENT", retryable: false, description: "Payment amount less than required" },
      { code: "ZERO_AMOUNT", retryable: false, description: "Amount cannot be zero" },
      { code: "MANDATE_NOT_DELEGATE", retryable: false, description: "Signer is not the authorized delegate" },
      { code: "MANDATE_EXPIRED", retryable: false, requiresHuman: true, description: "Mandate has expired" },
      { code: "MANDATE_PER_TX_EXCEEDED", retryable: false, description: "Amount exceeds per-transaction cap" },
      { code: "MANDATE_TOTAL_EXCEEDED", retryable: false, requiresHuman: true, description: "Lifetime spending cap reached" },
      { code: "MANDATE_REVOKED", retryable: false, requiresHuman: true, description: "Mandate revoked by delegator" },
      { code: "PREPAID_NOT_AGENT", retryable: false, description: "Signer is not the agent for this balance" },
      { code: "PREPAID_NOT_PROVIDER", retryable: false, description: "Signer is not the authorized provider" },
      { code: "PREPAID_WITHDRAWAL_LOCKED", retryable: true, description: "Withdrawal grace period active" },
      { code: "PREPAID_MAX_CALLS_EXCEEDED", retryable: false, description: "Maximum call count exceeded" },
      { code: "PREPAID_RATE_EXCEEDED", retryable: false, description: "Claim exceeds available balance" },
      // Network
      { code: "NETWORK_ERROR", retryable: true, description: "Sui RPC unreachable or timed out" },
      { code: "TIMEOUT", retryable: true, description: "RPC or HTTP request exceeded --timeout" },
      // Object lookups
      { code: "OBJECT_NOT_FOUND", retryable: false, description: "Object ID not found on-chain" },
      // pay-402 specific
      { code: "UNKNOWN_402", retryable: false, description: "Server returned 402 without s402 headers" },
      { code: "PAYMENT_FAILED", retryable: false, description: "s402 paid fetch failed — payment may have been submitted; check balance before retrying" },
      // System
      { code: "UNKNOWN_COMMAND", retryable: false, description: "Command not recognized" },
      { code: "INTERNAL_ERROR", retryable: false, description: "Unexpected error (bug)" },
    ],
  };
}

export function schema(): void {
  process.stdout.write(JSON.stringify(buildSchema(), null, 2) + "\n");
}
