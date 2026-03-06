import type { SuiJsonRpcClient, DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { createSuiClient } from "./utils";

/**
 * Client-side signer for creating and signing Sui transactions.
 * Any Sui signer works: Ed25519Keypair, Secp256k1Keypair, browser wallet adapter.
 */
export interface ClientSuiSigner {
  /**
   * The sender's Sui address
   */
  readonly address: string;

  /**
   * Sign a transaction without executing it
   *
   * @param transaction - The Transaction to sign
   * @returns Signature and serialized transaction bytes (both base64-encoded)
   */
  signTransaction(transaction: Transaction): Promise<{ signature: string; bytes: string }>;
}

/**
 * Facilitator-side signer for verifying, simulating, and broadcasting Sui transactions.
 * Encapsulates SuiJsonRpcClient operations and optional gas sponsorship signing.
 */
export interface FacilitatorSuiSigner {
  /**
   * Get all addresses this facilitator can use (for gas sponsorship)
   *
   * @returns Array of Sui addresses
   */
  getAddresses(): readonly string[];

  /**
   * Verify a signature over transaction bytes and recover the signer's address.
   * Supports Ed25519 and Secp256k1 signatures.
   * Note: zkLogin verification requires a SuiGraphQLClient, which is not yet supported.
   *
   * @param transactionBytes - Base64-encoded transaction bytes
   * @param signature - Base64-encoded signature
   * @param network - CAIP-2 network identifier
   * @returns The recovered signer's Sui address
   */
  verifySignature(transactionBytes: string, signature: string, network: string): Promise<string>;

  /**
   * Dry-run a transaction to check if it would succeed.
   * Returns the full DryRunTransactionBlockResponse including balanceChanges.
   *
   * @param transactionBytes - Base64-encoded transaction bytes
   * @param network - CAIP-2 network identifier
   * @returns Dry-run result with balance changes, effects, and events
   */
  simulateTransaction(
    transactionBytes: string,
    network: string,
  ): Promise<DryRunTransactionBlockResponse>;

  /**
   * Execute a signed transaction on-chain.
   * For standard payments, uses the client's signature directly (single string).
   * For sponsored transactions, pass [clientSig, sponsorSig] as an array.
   *
   * @param transaction - Base64-encoded transaction bytes
   * @param signature - Base64-encoded signature(s): single string or array for sponsored tx
   * @param network - CAIP-2 network identifier
   * @returns Transaction digest
   */
  executeTransaction(transaction: string, signature: string | string[], network: string): Promise<string>;

  /**
   * Wait for transaction finality
   *
   * @param digest - Transaction digest to wait for
   * @param network - CAIP-2 network identifier
   */
  waitForTransaction(digest: string, network: string): Promise<void>;

  /**
   * Fetch transaction details after execution (optional).
   * Used to extract created objects from settlement (e.g., PrepaidBalance ID).
   * If not implemented, settle will return without scheme-specific object IDs.
   *
   * @param digest - Transaction digest
   * @param network - CAIP-2 network identifier
   * @returns Transaction events (for extracting object IDs from Move events)
   */
  getTransactionBlock?(
    digest: string,
    network: string,
  ): Promise<{ events?: Array<{ type: string; parsedJson?: unknown }> }>;

  /**
   * Sign transaction bytes as gas sponsor (optional — only when keypair configured).
   * Used for sponsored transactions where the facilitator pays gas.
   *
   * @param transactionBytes - Base64-encoded transaction bytes
   * @returns Base64-encoded sponsor signature
   */
  sponsorSign?(transactionBytes: string): Promise<string>;
}

/**
 * Configuration for the facilitator signer
 */
export interface FacilitatorSuiSignerConfig {
  /**
   * Optional custom RPC URL
   */
  rpcUrl?: string;

  /**
   * Optional per-network RPC URL mapping
   */
  rpcUrls?: Record<string, string>;
}

/**
 * Create a FacilitatorSuiSigner from a SuiJsonRpcClient and optional keypair.
 * The keypair is only needed if this facilitator provides gas sponsorship.
 *
 * @param config - Optional configuration (custom RPC URLs)
 * @param keypair - Optional keypair for gas sponsorship signing
 * @returns A FacilitatorSuiSigner instance
 */
export function toFacilitatorSuiSigner(
  config?: FacilitatorSuiSignerConfig,
  keypair?: Signer,
): FacilitatorSuiSigner {
  const clientCache = new Map<string, SuiJsonRpcClient>();

  const getClient = (network: string): SuiJsonRpcClient => {
    const cached = clientCache.get(network);
    if (cached) return cached;

    const rpcUrl = config?.rpcUrls?.[network] ?? config?.rpcUrl;
    const client = createSuiClient(network, rpcUrl);
    clientCache.set(network, client);
    return client;
  };

  return {
    getAddresses(): readonly string[] {
      if (!keypair) return [];
      return [keypair.toSuiAddress()];
    },

    async verifySignature(transactionBytes: string, signature: string, _: string): Promise<string> {
      const txBytes = fromBase64(transactionBytes);
      const publicKey = await verifyTransactionSignature(txBytes, signature);
      return publicKey.toSuiAddress();
    },

    async simulateTransaction(
      transactionBytes: string,
      network: string,
    ): Promise<DryRunTransactionBlockResponse> {
      const client = getClient(network);
      return await client.dryRunTransactionBlock({
        transactionBlock: transactionBytes,
      });
    },

    async executeTransaction(
      transaction: string,
      signature: string | string[],
      network: string,
    ): Promise<string> {
      const client = getClient(network);

      const result = await client.executeTransactionBlock({
        transactionBlock: transaction,
        signature,
        options: {
          showEffects: true,
        },
      });

      if (result.effects?.status?.status !== "success") {
        throw new Error(
          `Transaction execution failed: ${result.effects?.status?.error || "unknown error"}`,
        );
      }

      return result.digest;
    },

    async waitForTransaction(digest: string, network: string): Promise<void> {
      const client = getClient(network);
      await client.waitForTransaction({
        digest,
        options: { showEffects: true },
      });
    },

    async getTransactionBlock(digest: string, network: string) {
      const client = getClient(network);
      const result = await client.getTransactionBlock({
        digest,
        options: { showEvents: true },
      });
      return { events: result.events ?? undefined };
    },

    // Only expose sponsorSign when a keypair is configured
    ...(keypair
      ? {
          async sponsorSign(transactionBytes: string): Promise<string> {
            const txBytes = fromBase64(transactionBytes);
            const { signature } = await keypair.signTransaction(txBytes);
            return signature;
          },
        }
      : {}),
  };
}

/**
 * Convert any Sui keypair to a ClientSuiSigner.
 * Works with Ed25519Keypair, Secp256k1Keypair, etc.
 *
 * @param keypair - Any Sui cryptographic keypair (Ed25519, Secp256k1, etc.)
 * @param client - SuiJsonRpcClient for building transactions
 * @returns A ClientSuiSigner instance
 */
export function toClientSuiSigner(keypair: Signer, client: SuiJsonRpcClient): ClientSuiSigner {
  return {
    address: keypair.toSuiAddress(),

    async signTransaction(transaction: Transaction): Promise<{ signature: string; bytes: string }> {
      const txBytes = await transaction.build({ client });
      const { signature } = await keypair.signTransaction(txBytes);
      const bytes = toBase64(txBytes);
      return { signature, bytes };
    },
  };
}
