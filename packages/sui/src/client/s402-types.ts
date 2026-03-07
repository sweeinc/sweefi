/**
 * Configuration and fetch types for the Sui s402 client.
 */

export type SuiNetwork = "sui:testnet" | "sui:mainnet" | "sui:devnet";

/**
 * Per-fetch s402 options. Passed as `s402` property on the fetch init object.
 *
 * @example
 * ```typescript
 * const response = await s402.fetch(url, {
 *   s402: { memo: 'swee:idempotency:abc-123' },
 * });
 * ```
 */
export interface S402FetchRequestOptions {
  /**
   * Memo string to embed in the on-chain PaymentReceipt's memo field (vector<u8>).
   * Requires `packageId` in the client config — without it, the memo is silently
   * skipped because raw coin transfers cannot carry memo data.
   */
  memo?: string;
}

/**
 * Extended fetch init that adds an optional `s402` namespace alongside
 * standard RequestInit properties. Fully backwards-compatible — existing
 * callers passing plain RequestInit continue to work unchanged.
 */
export interface S402FetchInit extends RequestInit {
  /** Per-fetch s402 options (memo, etc.) */
  s402?: S402FetchRequestOptions;
}

/**
 * Metadata about the payment attached to a successful paid-fetch Response.
 * Accessible as a non-enumerable `s402` property on the Response object:
 *
 * ```typescript
 * const response = await s402.fetch(url, { s402: { memo: 'test' } });
 * const meta = (response as any).s402 as S402PaymentMetadata | undefined;
 * console.log(meta?.txDigest);
 * ```
 *
 * Undefined when no payment was made (non-402 response) or when the server
 * didn't return settlement metadata (graceful degradation).
 */
export interface S402PaymentMetadata {
  /** Transaction digest on Sui */
  txDigest: string;
  /** On-chain PaymentReceipt object ID (if receipt was minted) */
  receiptId?: string;
  /** Payment scheme used (e.g., "exact", "prepaid") */
  scheme: string;
  /** Amount paid in base units */
  amount?: string;
  /** Gas cost in MIST (if available from settlement response) */
  gasCostMist?: number;
}

export interface s402ClientConfig {
  /** Sui keypair (Ed25519Keypair, Secp256k1Keypair, etc.) */
  wallet: import("@mysten/sui/cryptography").Signer;

  /** Target Sui network (e.g., "sui:testnet") */
  network: SuiNetwork;

  /** Custom RPC URL (optional) */
  rpcUrl?: string;

  /** Custom facilitator URL (optional) */
  facilitatorUrl?: string;

  /**
   * SweeFi package ID on Sui.
   * Required for stream, escrow, and seal schemes.
   * If omitted, only exact payments are supported.
   */
  packageId?: string;

  /**
   * Mandate configuration for agents with delegated spending authorization.
   * When provided, the exact scheme includes a `validate_and_spend` MoveCall
   * in payment PTBs when the server requires mandate authorization.
   * Requires `packageId` to also be set.
   */
  mandate?: {
    /** Mandate object ID (owned by this agent/delegate) */
    mandateId: string;
    /** RevocationRegistry object ID (shared object) */
    registryId: string;
  };
}
