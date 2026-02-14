import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import type { Keypair } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TESTNET_PACKAGE_ID, testnetConfig } from "@sweepay/sui/ptb";
import type { SweepayConfig } from "@sweepay/sui/ptb";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 * Runtime context shared across all MCP tools.
 * Read-only tools work without a signer; transaction tools require one.
 */
export interface SweepayContext {
  suiClient: SuiClient;
  signer: Keypair | null;
  config: SweepayConfig;
  network: string;
}

export interface SweepayMcpConfig {
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
}

/**
 * Create the runtime context from config or environment variables.
 * Falls back to SUI_NETWORK, SUI_RPC_URL, SUI_PRIVATE_KEY env vars.
 */
export function createContext(config?: SweepayMcpConfig): SweepayContext {
  const network = config?.network ?? process.env.SUI_NETWORK ?? "testnet";
  const rpcUrl = config?.rpcUrl ?? process.env.SUI_RPC_URL;

  const suiNetwork = network.replace("sui:", "") as "testnet" | "mainnet" | "devnet";
  const suiClient = rpcUrl
    ? new SuiClient({ url: rpcUrl })
    : new SuiClient({ url: getFullnodeUrl(suiNetwork) });

  const packageId = config?.packageId ?? process.env.SUI_PACKAGE_ID ?? TESTNET_PACKAGE_ID;
  const protocolStateId = config?.protocolStateId ?? process.env.SUI_PROTOCOL_STATE_ID;
  const sweepayConfig: SweepayConfig = { packageId, protocolStateId };

  const privateKey = config?.privateKey ?? process.env.SUI_PRIVATE_KEY;
  let signer: Keypair | null = null;

  if (privateKey) {
    try {
      // Try bech32 format first (suiprivkey1...)
      const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
      if (schema === "ED25519") {
        signer = Ed25519Keypair.fromSecretKey(secretKey);
      } else {
        console.warn(`[sweepay-mcp] Key scheme "${schema}" is not supported. Only ED25519 keys work. Transaction tools will be disabled.`);
      }
    } catch {
      // Fall back to raw base64
      try {
        const bytes = Uint8Array.from(atob(privateKey), (c) => c.charCodeAt(0));
        signer = Ed25519Keypair.fromSecretKey(bytes);
      } catch (e) {
        console.error(
          `[sweepay-mcp] Failed to parse SUI_PRIVATE_KEY. Tried bech32 (suiprivkey1...) and raw base64 — both failed. ` +
          `Transaction tools will be disabled. Error: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  }

  return { suiClient, signer, config: sweepayConfig, network };
}

/**
 * Ensure a signer is available. Throws a clear error if not.
 */
export function requireSigner(ctx: SweepayContext): Keypair {
  if (!ctx.signer) {
    throw new Error(
      "Wallet not configured. Set SUI_PRIVATE_KEY environment variable " +
      "to enable transaction tools. Read-only tools (balance, receipt, " +
      "supported tokens) work without a wallet."
    );
  }
  return ctx.signer;
}
