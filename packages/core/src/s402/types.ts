/**
 * s402 Protocol Types — Sui-native HTTP 402 transport layer
 *
 * s402 (small s) is a Sui-native HTTP 402 protocol that is wire-compatible
 * with x402's JSON format but architecturally superior:
 *   - Atomic PTBs eliminate the verify/settle temporal gap
 *   - Four payment schemes: exact, stream, escrow, seal
 *   - AP2 mandate support for agent spending authorization
 *   - Direct settlement mode (no facilitator needed)
 *   - On-chain receipts as NFT proofs
 *
 * Branding: protocol version field = s402Version (lowercase s).
 * TypeScript types use camelCase per TS convention.
 */

// ══════════════════════════════════════════════════════════════
// Protocol version
// ══════════════════════════════════════════════════════════════

/** Current protocol version. Always lowercase s. */
export const S402_VERSION = '1' as const;

// ══════════════════════════════════════════════════════════════
// Payment schemes
// ══════════════════════════════════════════════════════════════

/** The four s402 payment schemes */
export type s402Scheme = 'exact' | 'stream' | 'escrow' | 'seal';

/** Settlement mode: facilitator-mediated or direct on-chain */
export type s402SettlementMode = 'facilitator' | 'direct';

// ══════════════════════════════════════════════════════════════
// Payment requirements (server → client in 402 response)
// ══════════════════════════════════════════════════════════════

/**
 * Base payment requirements — included in every 402 response.
 * Wire-compatible with x402 PaymentRequirements where fields overlap.
 */
export interface s402PaymentRequirements {
  /** Protocol version (always "1") */
  s402Version: typeof S402_VERSION;
  /** Which payment schemes the server accepts. Always includes "exact" for x402 compat. */
  accepts: s402Scheme[];
  /** Sui network (e.g., "sui:testnet", "sui:mainnet") */
  network: string;
  /** Move coin type (e.g., "0x2::sui::SUI") */
  asset: string;
  /** Amount in base units (MIST for SUI, 6-decimal for USDC) */
  amount: string;
  /** Recipient address */
  payTo: string;
  /** Facilitator URL (optional for direct settlement) */
  facilitatorUrl?: string;

  // ── s402 extensions (not in x402) ──

  /** AP2 mandate requirements (if agent spending authorization is needed) */
  mandate?: s402MandateRequirements;
  /** Protocol fee in basis points (0-10000). 0 = no fee. */
  protocolFeeBps?: number;
  /** Address that receives the protocol fee. Defaults to payTo if omitted. */
  protocolFeeAddress?: string;
  /** Whether the server requires an on-chain receipt NFT */
  receiptRequired?: boolean;
  /** Settlement mode preference */
  settlementMode?: s402SettlementMode;

  // ── Scheme-specific extras ──

  /** Extra fields for stream scheme */
  stream?: s402StreamExtra;
  /** Extra fields for escrow scheme */
  escrow?: s402EscrowExtra;
  /** Extra fields for seal scheme */
  seal?: s402SealExtra;

  /** Arbitrary extra data (forward-compatible) */
  extra?: Record<string, unknown>;
}

/** Stream-specific requirements */
export interface s402StreamExtra {
  /** Rate in base units per second */
  ratePerSecond: string;
  /** Maximum budget cap in base units */
  budgetCap: string;
  /** Minimum initial deposit in base units */
  minDeposit: string;
  /** URL for stream status checks (phase 2) */
  streamSetupUrl?: string;
}

/** Escrow-specific requirements */
export interface s402EscrowExtra {
  /** Seller/payee address */
  seller: string;
  /** Arbiter address for dispute resolution */
  arbiter?: string;
  /** Escrow deadline in milliseconds since epoch */
  deadlineMs: string;
}

/** SEAL-specific requirements */
export interface s402SealExtra {
  /** Encryption ID for SEAL key servers */
  encryptionId: string;
  /** Walrus blob ID containing the encrypted content */
  walrusBlobId: string;
  /** SEAL package ID on Sui */
  sealPackageId: string;
}

// ══════════════════════════════════════════════════════════════
// AP2 Mandate (agent spending authorization)
// ══════════════════════════════════════════════════════════════

/** Mandate requirements in a 402 response — tells client what mandate is needed */
export interface s402MandateRequirements {
  /** Whether a mandate is required (true) or optional (false = speeds up if present) */
  required: boolean;
  /** Minimum per-transaction limit needed */
  minPerTx?: string;
  /** Mandate coin type (must match payment asset) */
  coinType?: string;
}

/** On-chain mandate reference — included in payment payload when agent has authorization */
export interface s402Mandate {
  /** Mandate object ID on Sui */
  mandateId: string;
  /** Delegator (human) address */
  delegator: string;
  /** Delegate (agent) address */
  delegate: string;
  /** Per-transaction spending limit */
  maxPerTx: string;
  /** Lifetime spending cap */
  maxTotal: string;
  /** Amount already spent */
  totalSpent: string;
  /** Expiry timestamp (ms since epoch) */
  expiresAtMs: string;
}

// ══════════════════════════════════════════════════════════════
// Payment payload (client → server/facilitator)
// ══════════════════════════════════════════════════════════════

/** Base payload — all schemes include these fields */
export interface s402PaymentPayloadBase {
  /** Protocol version */
  s402Version: typeof S402_VERSION;
  /** Which scheme is being used */
  scheme: s402Scheme;
}

/** Exact payment: signed transaction bytes */
export interface s402ExactPayload extends s402PaymentPayloadBase {
  scheme: 'exact';
  payload: {
    /** Base64-encoded signed transaction bytes */
    transaction: string;
    /** Base64-encoded signature */
    signature: string;
  };
}

/** Stream payment: signed stream creation transaction */
export interface s402StreamPayload extends s402PaymentPayloadBase {
  scheme: 'stream';
  payload: {
    transaction: string;
    signature: string;
  };
}

/** Escrow payment: signed escrow creation transaction */
export interface s402EscrowPayload extends s402PaymentPayloadBase {
  scheme: 'escrow';
  payload: {
    transaction: string;
    signature: string;
  };
}

/** SEAL payment: signed escrow + seal setup */
export interface s402SealPayload extends s402PaymentPayloadBase {
  scheme: 'seal';
  payload: {
    /** Escrow creation transaction */
    transaction: string;
    signature: string;
    /** SEAL encryption ID */
    encryptionId: string;
  };
}

/** Discriminated union of all payment payloads */
export type s402PaymentPayload =
  | s402ExactPayload
  | s402StreamPayload
  | s402EscrowPayload
  | s402SealPayload;

// ══════════════════════════════════════════════════════════════
// Settlement response (facilitator/server → client)
// ══════════════════════════════════════════════════════════════

export interface s402SettleResponse {
  /** Whether settlement was successful */
  success: boolean;
  /** Transaction digest on Sui */
  txDigest?: string;
  /** On-chain receipt object ID (if receipt was minted) */
  receiptId?: string;
  /** Time to finality in milliseconds */
  finalityMs?: number;
  /** Stream object ID (for stream scheme) */
  streamId?: string;
  /** Escrow object ID (for escrow scheme) */
  escrowId?: string;
  /** Error message if settlement failed */
  error?: string;
}

export interface s402VerifyResponse {
  /** Whether the payment payload is valid */
  valid: boolean;
  /** Reason for rejection */
  invalidReason?: string;
  /** Payer address (recovered from signature) */
  payerAddress?: string;
}

// ══════════════════════════════════════════════════════════════
// Discovery (.well-known/s402.json)
// ══════════════════════════════════════════════════════════════

export interface s402Discovery {
  /** Protocol version */
  s402Version: typeof S402_VERSION;
  /** Supported schemes */
  schemes: s402Scheme[];
  /** Supported Sui networks */
  networks: string[];
  /** Supported coin types */
  assets: string[];
  /** Facilitator URL */
  facilitatorUrl?: string;
  /** Whether direct settlement is supported */
  directSettlement: boolean;
  /** Whether mandates are supported */
  mandateSupport: boolean;
  /** Protocol fee in basis points */
  protocolFeeBps: number;
  /** Address that receives the protocol fee */
  protocolFeeAddress?: string;
}

// ══════════════════════════════════════════════════════════════
// Wire format helpers
// ══════════════════════════════════════════════════════════════

/** HTTP headers used by s402 (same names as x402 for compatibility) */
export const S402_HEADERS = {
  /** Server → client: payment requirements (base64 JSON in 402 response) */
  PAYMENT_REQUIRED: 'payment-required',
  /** Client → server: payment payload (base64 JSON) */
  PAYMENT: 'X-PAYMENT',
  /** Server → client: settlement result (base64 JSON) */
  PAYMENT_RESPONSE: 'payment-response',
  /** Client → server: active stream ID (phase 2 of stream protocol) */
  STREAM_ID: 'X-STREAM-ID',
} as const;
