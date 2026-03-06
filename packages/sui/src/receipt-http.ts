/**
 * HTTP transport layer for v0.2 signed usage receipts.
 *
 * Provider-side: sign each API response and format as an HTTP header.
 * Agent-side: parse the header, verify the signature, accumulate for disputes.
 *
 * Header format (versioned for forward compatibility):
 *   v2:base64(signature):callNumber:timestampMs:base64(responseHash)
 *
 * The v2 prefix allows v0.3 (TEE attestation) to extend the format
 * without breaking existing parsers.
 *
 * @see receipts.ts — BCS message construction and Ed25519 sign/verify
 * @see docs/adr/007-prepaid-trust-model.md — trust model evolution
 */

import { signReceipt, buildReceiptMessage } from './receipts.js';
import type { Ed25519Signer, Ed25519Verifier } from './receipts.js';
import { toBase64, fromBase64 } from '@mysten/sui/utils';

// ── Constants ────────────────────────────────────────

/** HTTP header name for s402 signed usage receipts. */
export const S402_RECEIPT_HEADER = 'X-S402-Receipt';

const HEADER_VERSION = 'v2';

// ── Types ────────────────────────────────────────────

/** A verified receipt ready for accumulation or dispute construction. */
export interface VerifiedReceipt {
  readonly signature: Uint8Array;
  readonly callNumber: bigint;
  readonly timestampMs: bigint;
  readonly responseHash: Uint8Array;
}

/** Result of parsing a receipt header. */
export interface ParsedReceipt extends VerifiedReceipt {
  /**
   * Signature verification status:
   * - `true`: signature verified against balanceId + fields
   * - `false`: signature verification failed
   * - `null`: no verifier provided (parse-only mode)
   */
  readonly verified: boolean | null;
}

// ── Provider-side: Sign + Format ─────────────────────

/**
 * Sign a usage receipt and format it as an HTTP header value.
 *
 * Called by the provider after each API response. The resulting header
 * string is set on the response as `X-S402-Receipt`.
 *
 * @param sign - Ed25519 signing function (e.g., `(msg) => keypair.sign(msg)`)
 * @param balanceId - PrepaidBalance object address (0x-prefixed, 64 hex chars)
 * @param callNumber - Sequential call number (1-indexed)
 * @param timestampMs - Unix timestamp in milliseconds
 * @param responseHash - Hash of the API response body (typically SHA-256, 32 bytes)
 * @returns Object with `header` string ready for HTTP response
 */
export async function signUsageReceipt(
  sign: Ed25519Signer,
  balanceId: string,
  callNumber: bigint,
  timestampMs: bigint,
  responseHash: Uint8Array,
): Promise<{ header: string }> {
  const { signature } = await signReceipt(sign, balanceId, callNumber, timestampMs, responseHash);
  const header = [
    HEADER_VERSION,
    toBase64(signature),
    callNumber.toString(),
    timestampMs.toString(),
    toBase64(responseHash),
  ].join(':');
  return { header };
}

// ── Agent-side: Parse + Verify ───────────────────────

/**
 * Parse an `X-S402-Receipt` header value and optionally verify the signature.
 *
 * Called by the agent after each API response. If a verifier is provided,
 * the signature is checked against the BCS-encoded receipt message
 * (same format the Move contract reconstructs in `dispute_claim()`).
 *
 * @param header - Raw header value from `X-S402-Receipt`
 * @param balanceId - PrepaidBalance object address (needed for BCS message reconstruction)
 * @param verify - Optional Ed25519 verifier. When provided, signature is checked.
 * @returns Parsed receipt with verification status
 * @throws On malformed headers or unknown version prefixes
 */
export async function parseUsageReceipt(
  header: string,
  balanceId: string,
  verify?: Ed25519Verifier,
): Promise<ParsedReceipt> {
  if (!header) {
    throw new Error('Empty receipt header');
  }

  const parts = header.split(':');
  if (parts.length !== 5) {
    throw new Error(
      `Malformed receipt header: expected 5 colon-separated parts, got ${parts.length}`,
    );
  }

  const [version, sigB64, callNumberStr, timestampMsStr, hashB64] = parts;

  if (version !== HEADER_VERSION) {
    throw new Error(`Unknown receipt header version: "${version}" (expected "${HEADER_VERSION}")`);
  }

  const signature = fromBase64(sigB64);
  const callNumber = BigInt(callNumberStr);
  const timestampMs = BigInt(timestampMsStr);
  const responseHash = fromBase64(hashB64);

  let verified: boolean | null = null;
  if (verify) {
    const message = buildReceiptMessage(balanceId, callNumber, timestampMs, responseHash);
    verified = await verify(message, signature);
  }

  return { signature, callNumber, timestampMs, responseHash, verified };
}

// ── Agent-side: Receipt Accumulator ──────────────────

/**
 * In-memory receipt store for a single PrepaidBalance.
 *
 * Agents use this to track provider-signed receipts for potential
 * fraud proof construction. The highest-numbered receipt is the one
 * needed for `dispute_claim()` on-chain.
 *
 * **Limitations (MVP):**
 * - In-memory only — receipts lost on process crash. For high-value
 *   balances, persist receipts externally.
 * - No automatic pruning — memory grows with call count. For long-running
 *   agents, periodically prune old receipts (only the highest matters
 *   for disputes).
 *
 * **Fraud detection:** If the provider sends two receipts with the same
 * callNumber but different responseHash values, both are kept and a
 * warning is logged. This is evidence of provider fraud (signing
 * contradictory responses for the same call).
 *
 * @example
 * ```ts
 * const acc = new ReceiptAccumulator('0xbalance...');
 * const parsed = await parseUsageReceipt(header, balanceId, verifier);
 * if (parsed.verified) acc.add(parsed);
 * const highest = acc.getHighest(); // for dispute_claim()
 * ```
 */
export class ReceiptAccumulator {
  readonly balanceId: string;
  private receipts = new Map<string, VerifiedReceipt[]>(); // callNumber → receipts

  constructor(balanceId: string) {
    this.balanceId = balanceId;
  }

  /**
   * Add a verified receipt. Only accepts receipts that have been
   * signature-verified to prevent accumulating tampered data.
   */
  add(receipt: VerifiedReceipt): void {
    const key = receipt.callNumber.toString();
    const existing = this.receipts.get(key);

    if (existing) {
      // Check for duplicate with different hash (fraud indicator)
      const isDuplicate = existing.some(
        (r) => arraysEqual(r.responseHash, receipt.responseHash),
      );
      if (isDuplicate) return; // Exact duplicate, skip

      // Same callNumber, different responseHash — evidence of provider fraud
      console.warn(
        `[ReceiptAccumulator] Fraud indicator: provider signed different responses ` +
        `for callNumber ${receipt.callNumber} on balance ${this.balanceId}`,
      );
      existing.push(receipt);
    } else {
      this.receipts.set(key, [receipt]);
    }
  }

  /** Get the receipt with the highest callNumber (needed for dispute_claim). */
  getHighest(): VerifiedReceipt | undefined {
    let highest: VerifiedReceipt | undefined;
    for (const group of this.receipts.values()) {
      for (const r of group) {
        if (!highest || r.callNumber > highest.callNumber) {
          highest = r;
        }
      }
    }
    return highest;
  }

  /** Get all accumulated receipts, sorted by callNumber ascending. */
  getAll(): VerifiedReceipt[] {
    const all: VerifiedReceipt[] = [];
    for (const group of this.receipts.values()) {
      all.push(...group);
    }
    return all.sort((a, b) => (a.callNumber < b.callNumber ? -1 : a.callNumber > b.callNumber ? 1 : 0));
  }

  /** Number of unique call numbers accumulated. */
  get count(): number {
    return this.receipts.size;
  }
}

// ── Helpers ──────────────────────────────────────────

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
