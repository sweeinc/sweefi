/**
 * CLI runtime context — adapted from @sweefi/mcp context.ts
 *
 * Reads configuration from environment variables only. No config files.
 * The env-var-only model is deliberate: zero stored state means zero drift,
 * zero exfiltration surface, and one-line agent provisioning.
 *
 * Context is intentionally self-contained — no cross-package shared context needed.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { Keypair } from "@mysten/sui/cryptography";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TESTNET_PACKAGE_ID, TESTNET_PROTOCOL_STATE } from "@sweefi/sui/ptb";
import type { SweefiConfig } from "@sweefi/sui/ptb";

export type SuiNetwork = "testnet" | "mainnet" | "devnet";

export interface CliContext {
  suiClient: SuiJsonRpcClient;
  signer: Keypair | null;
  config: SweefiConfig;
  network: SuiNetwork;
  verbose: boolean;
  timeoutMs: number;
}

/**
 * Create context from env vars + optional CLI flag overrides.
 * Flags always win over env vars (12-factor app convention).
 */
const VALID_NETWORKS = new Set<string>(["testnet", "mainnet", "devnet"]);

const DEFAULT_TIMEOUT_MS = 30_000;

export function createContext(overrides?: { network?: string; verbose?: boolean; timeout?: number }): CliContext {
  const raw = overrides?.network ?? process.env.SUI_NETWORK ?? "testnet";
  if (!VALID_NETWORKS.has(raw)) {
    throw new CliError("INVALID_NETWORK", `Unknown network: "${raw}"`, false, "Use testnet, mainnet, or devnet");
  }
  const network = raw as SuiNetwork;
  const rpcUrl = process.env.SUI_RPC_URL;

  const suiClient = rpcUrl
    ? new SuiJsonRpcClient({ url: rpcUrl, network })
    : new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  const packageId = process.env.SUI_PACKAGE_ID ?? TESTNET_PACKAGE_ID;
  const protocolStateId = process.env.SUI_PROTOCOL_STATE_ID ?? TESTNET_PROTOCOL_STATE;
  const config: SweefiConfig = { packageId, protocolStateId };

  const privateKey = process.env.SUI_PRIVATE_KEY;
  let signer: Keypair | null = null;

  if (privateKey) {
    try {
      const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
      if (scheme === "ED25519") {
        signer = Ed25519Keypair.fromSecretKey(secretKey);
      }
    } catch {
      try {
        const bytes = Uint8Array.from(atob(privateKey), (c) => c.charCodeAt(0));
        signer = Ed25519Keypair.fromSecretKey(bytes);
      } catch {
        // Will fail at requireSigner() with a clear message
      }
    }
  }

  const verbose = overrides?.verbose ?? false;
  const timeoutMs = overrides?.timeout ?? DEFAULT_TIMEOUT_MS;

  return { suiClient, signer, config, network, verbose, timeoutMs };
}

/**
 * Write debug output to stderr. Only produces output when --verbose is set.
 * Uses stderr so stdout JSON stays machine-parseable.
 */
export function debug(ctx: CliContext, ...args: unknown[]): void {
  if (!ctx.verbose) return;
  const timestamp = new Date().toISOString();
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  process.stderr.write(`[sweefi ${timestamp}] ${msg}\n`);
}

/**
 * Wrap a promise with the context's timeout. Throws CliError on timeout.
 * Use this around any RPC call to enforce --timeout globally.
 */
export async function withTimeout<T>(ctx: CliContext, promise: Promise<T>, label = "RPC call"): Promise<T> {
  if (ctx.timeoutMs <= 0 || ctx.timeoutMs === Infinity) return promise;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CliError("TIMEOUT", `${label} timed out after ${ctx.timeoutMs}ms`, true, `Increase --timeout or check RPC connectivity`)), ctx.timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Require a signer or fail with a clear, actionable error. */
export function requireSigner(ctx: CliContext): Keypair {
  if (!ctx.signer) {
    throw new CliError(
      "NO_WALLET",
      "SUI_PRIVATE_KEY environment variable is not set",
      false,
      "Export SUI_PRIVATE_KEY=suiprivkey1... to enable transactions",
    );
  }
  return ctx.signer;
}

/** Structured error with s402-style fields for JSON output. */
export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly suggestedAction?: string,
    /** True when only a human (not the agent) can resolve this error. */
    public readonly requiresHumanAction: boolean = false,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Strip anything that could be key material from error messages before output. */
export function sanitize(msg: string): string {
  return msg
    .replace(/suiprivkey1[a-z0-9]{50,}/gi, "[REDACTED]")
    // 40+ base64 chars covers Ed25519 raw keys (32 bytes → 44 chars) and larger secrets.
    // Previous threshold of 60 missed Ed25519 base64-encoded private keys entirely.
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[REDACTED]");
}

/** Detect network/RPC errors from the Sui client — these are retryable. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|NetworkError/i.test(msg);
}
