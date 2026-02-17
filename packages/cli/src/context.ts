/**
 * CLI runtime context — adapted from @sweepay/mcp context.ts
 *
 * Reads configuration from environment variables only. No config files.
 * The env-var-only model is deliberate: zero stored state means zero drift,
 * zero exfiltration surface, and one-line agent provisioning.
 *
 * TODO: When @sweepay/core gains a shared createContext(), use that instead.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { Keypair } from "@mysten/sui/cryptography";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TESTNET_PACKAGE_ID, TESTNET_PROTOCOL_STATE } from "@sweepay/sui/ptb";
import type { SweepayConfig } from "@sweepay/sui/ptb";

export type SuiNetwork = "testnet" | "mainnet" | "devnet";

export interface CliContext {
  suiClient: SuiJsonRpcClient;
  signer: Keypair | null;
  config: SweepayConfig;
  network: SuiNetwork;
}

/**
 * Create context from env vars + optional CLI flag overrides.
 * Flags always win over env vars (12-factor app convention).
 */
const VALID_NETWORKS = new Set<string>(["testnet", "mainnet", "devnet"]);

export function createContext(overrides?: { network?: string }): CliContext {
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
  const config: SweepayConfig = { packageId, protocolStateId };

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

  return { suiClient, signer, config, network };
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
