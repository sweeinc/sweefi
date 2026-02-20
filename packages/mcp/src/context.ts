import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { Keypair } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TESTNET_PACKAGE_ID } from "@sweefi/sui/ptb";
import type { SweefiConfig } from "@sweefi/sui/ptb";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 * Runtime context shared across all MCP tools.
 * Read-only tools work without a signer; transaction tools require one.
 */
export interface SweefiContext {
  suiClient: SuiJsonRpcClient;
  signer: Keypair | null;
  config: SweefiConfig;
  network: string;
  /** Spending limits enforced by the MCP server. */
  spendingLimits: SpendingLimits;
}

/**
 * D-03/D-05 (Trust boundary): These limits protect against LLM misbehavior
 * (e.g., the model deciding to spend 1000 SUI instead of 0.001 SUI).
 * They are NOT a security boundary against host compromise — the private key
 * is in-process and can be extracted by a compromised host. On-chain Mandates
 * are the real enforcement layer for untrusted agents.
 *
 * B-16 (Volatility): sessionSpent is in-memory and resets on process restart.
 * A malicious host can restart the MCP server to reset the session limit.
 * Per-session limits are a best-effort guard, not a hard security boundary.
 * For hard spending caps, use on-chain Mandates with lifetime limits.
 */
export interface SpendingLimits {
  /** Max base-unit amount per single transaction. 0n = unlimited. */
  maxPerTx: bigint;
  /** Max cumulative base-unit amount per session. 0n = unlimited. */
  maxPerSession: bigint;
  /** Running total spent in this session. Mutated on each successful tx. */
  sessionSpent: bigint;
}

export interface SweefiMcpConfig {
  /** Sui network: "testnet" | "mainnet" | "devnet" */
  network?: string;
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Bech32-encoded private key (suiprivkey1...) or raw base64 */
  privateKey?: string;
  /** Override package ID (defaults to testnet) */
  packageId?: string;
  /** Shared ProtocolState object ID (required for admin + stream/escrow create) */
  protocolStateId?: string;
  /** Enable admin tools (pause/unpause/burn). Defaults to false for safety. */
  enableAdminTools?: boolean;
  /** Enable provider-side tools (prepaid claim). Defaults to false.
   *  Only enable when the MCP server is running as a provider, not a consumer agent. */
  enableProviderTools?: boolean;
  /** Per-transaction spending limit in base units. 0 = no limit. */
  maxAmountPerTx?: bigint;
  /** Per-session cumulative spending limit in base units. 0 = no limit. */
  maxAmountPerSession?: bigint;
}

function parseBigIntEnv(name: string): bigint {
  const raw = process.env[name] ?? "0";
  try {
    // Strip underscores (1_000_000_000) and trailing 'n' (1000n) for user convenience
    return BigInt(raw.replace(/_/g, "").replace(/n$/i, ""));
  } catch {
    throw new Error(
      `${name}="${raw}" is not a valid integer. Use digits only (e.g., "1000000000").`
    );
  }
}

/**
 * Create the runtime context from config or environment variables.
 * Falls back to SUI_NETWORK, SUI_RPC_URL, SUI_PRIVATE_KEY env vars.
 */
export function createContext(config?: SweefiMcpConfig): SweefiContext {
  const network = config?.network ?? process.env.SUI_NETWORK ?? "testnet";
  const rpcUrl = config?.rpcUrl ?? process.env.SUI_RPC_URL;

  const VALID_NETWORKS = new Set(["testnet", "mainnet", "devnet"]);
  const suiNetwork = network.replace("sui:", "");
  if (!rpcUrl && !VALID_NETWORKS.has(suiNetwork)) {
    throw new Error(
      `Invalid SUI_NETWORK "${network}". Must be "testnet", "mainnet", or "devnet". ` +
      `For custom networks, set SUI_RPC_URL instead.`
    );
  }
  const suiClient = rpcUrl
    ? new SuiJsonRpcClient({ url: rpcUrl, network: suiNetwork })
    : new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(suiNetwork as "testnet" | "mainnet" | "devnet"), network: suiNetwork });

  const packageId = config?.packageId ?? process.env.SUI_PACKAGE_ID ?? TESTNET_PACKAGE_ID;
  const protocolStateId = config?.protocolStateId ?? process.env.SUI_PROTOCOL_STATE_ID;
  const sweefiConfig: SweefiConfig = { packageId, protocolStateId };

  const privateKey = config?.privateKey ?? process.env.SUI_PRIVATE_KEY;
  let signer: Keypair | null = null;

  if (privateKey) {
    try {
      // Try bech32 format first (suiprivkey1...)
      const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
      if (scheme === "ED25519") {
        signer = Ed25519Keypair.fromSecretKey(secretKey);
      } else {
        console.warn(`[sweefi-mcp] Key scheme "${scheme}" is not supported. Only ED25519 keys work. Transaction tools will be disabled.`);
      }
    } catch {
      // Fall back to raw base64
      try {
        const bytes = Uint8Array.from(atob(privateKey), (c) => c.charCodeAt(0));
        signer = Ed25519Keypair.fromSecretKey(bytes);
      } catch {
        // Do NOT log error details — they may contain key material fragments.
        console.error(
          `[sweefi-mcp] Failed to parse SUI_PRIVATE_KEY. ` +
          `Ensure it is a valid bech32 (suiprivkey1...) or base64-encoded Ed25519 key. ` +
          `Transaction tools will be disabled.`
        );
      }
    }
  }

  const spendingLimits: SpendingLimits = {
    maxPerTx: config?.maxAmountPerTx ?? parseBigIntEnv("MCP_MAX_PER_TX"),
    maxPerSession: config?.maxAmountPerSession ?? parseBigIntEnv("MCP_MAX_PER_SESSION"),
    sessionSpent: 0n,
  };

  return { suiClient, signer, config: sweefiConfig, network, spendingLimits };
}

/**
 * Check spending limits before executing a transaction.
 * Throws if the amount would exceed per-tx or per-session caps.
 *
 * TRUST BOUNDARY: These limits protect against LLM misbehavior (e.g., the model
 * deciding to spend 1000 SUI instead of 0.001 SUI). They are NOT a security
 * boundary against host compromise — the private key is in-process. On-chain
 * Mandates are the real enforcement layer for untrusted agents.
 *
 * On success, debits the session total (caller must only call after a successful tx).
 */
export function checkSpendingLimit(ctx: SweefiContext, amount: bigint): void {
  // D-02: Guard against zero/negative amounts reaching the spending check
  if (amount <= 0n) {
    throw new Error(
      `Transaction amount must be positive, got ${amount}. ` +
      `Zero or negative amounts should not reach the spending check.`
    );
  }

  const { maxPerTx, maxPerSession, sessionSpent } = ctx.spendingLimits;

  if (maxPerTx > 0n && amount > maxPerTx) {
    throw new Error(
      `Transaction amount (${amount}) exceeds per-transaction limit (${maxPerTx}). ` +
      `Configure MCP_MAX_PER_TX or maxAmountPerTx to adjust.`
    );
  }

  if (maxPerSession > 0n && sessionSpent + amount > maxPerSession) {
    throw new Error(
      `Transaction would exceed session spending limit. ` +
      `Spent: ${sessionSpent}, requested: ${amount}, limit: ${maxPerSession}. ` +
      `Configure MCP_MAX_PER_SESSION or maxAmountPerSession to adjust.`
    );
  }
}

/**
 * Record a successful spend against the session limit.
 * Call ONLY after a transaction succeeds.
 */
export function recordSpend(ctx: SweefiContext, amount: bigint): void {
  ctx.spendingLimits.sessionSpent += amount;
}

/**
 * Ensure a signer is available. Throws a clear error if not.
 */
export function requireSigner(ctx: SweefiContext): Keypair {
  if (!ctx.signer) {
    throw new Error(
      "Wallet not configured. Set SUI_PRIVATE_KEY environment variable " +
      "to enable transaction tools. Read-only tools (balance, receipt, " +
      "supported tokens) work without a wallet."
    );
  }
  return ctx.signer;
}
