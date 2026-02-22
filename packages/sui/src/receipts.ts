/**
 * Receipt utilities for v0.2 signed usage receipts.
 *
 * Providers sign each API response with an Ed25519 key. The signed receipt
 * includes the balance ID, call number, timestamp, and response hash.
 * If the provider over-claims, the agent submits a receipt as a fraud proof.
 *
 * Message format (BCS-encoded, matches Move's dispute_claim reconstruction):
 *   bcs(balance_id: address) || bcs(call_number: u64) ||
 *   bcs(timestamp_ms: u64)   || bcs(response_hash: vector<u8>)
 *
 * Total: 32 + 8 + 8 + (1 + hash.length) bytes
 */

// ── BCS encoding helpers ──────────────────────────────────

function bcsAddress(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length !== 64) {
    throw new Error(`Address must be 64 hex chars, got ${clean.length}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bcsU64(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true); // little-endian
  return buf;
}

function bcsVectorU8(bytes: Uint8Array): Uint8Array {
  const prefix = ulebEncode(bytes.length);
  const result = new Uint8Array(prefix.length + bytes.length);
  result.set(prefix, 0);
  result.set(bytes, prefix.length);
  return result;
}

function ulebEncode(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return new Uint8Array(bytes);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ── Public API ──────────────────────────────────────

/**
 * Build the receipt message that gets signed by the provider.
 * This must produce the exact same bytes as Move's dispute_claim() reconstruction.
 *
 * @param balanceId - PrepaidBalance object address (0x-prefixed, 64 hex chars)
 * @param callNumber - Sequential call number (1-indexed)
 * @param timestampMs - Unix timestamp in milliseconds
 * @param responseHash - Hash of the API response (typically 32 bytes)
 * @returns BCS-encoded message bytes
 */
export function buildReceiptMessage(
  balanceId: string,
  callNumber: bigint,
  timestampMs: bigint,
  responseHash: Uint8Array,
): Uint8Array {
  return concat(
    bcsAddress(balanceId),
    bcsU64(callNumber),
    bcsU64(timestampMs),
    bcsVectorU8(responseHash),
  );
}

/** A pluggable Ed25519 signer — keeps this module zero-dependency. */
export type Ed25519Signer = (message: Uint8Array) => Promise<Uint8Array> | Uint8Array;

/** A pluggable Ed25519 verifier — keeps this module zero-dependency. */
export type Ed25519Verifier = (message: Uint8Array, signature: Uint8Array) => Promise<boolean> | boolean;

/**
 * Sign a receipt message using a pluggable Ed25519 signer.
 *
 * Example with @mysten/sui keypair:
 * ```ts
 * const signer = (msg) => keypair.sign(msg);
 * const { signature, message } = await signReceipt(signer, ...);
 * ```
 *
 * @param sign - Ed25519 signing function
 * @param balanceId - PrepaidBalance object address
 * @param callNumber - Sequential call number
 * @param timestampMs - Unix timestamp in milliseconds
 * @param responseHash - Hash of the API response
 * @returns Object with signature bytes and the signed message
 */
export async function signReceipt(
  sign: Ed25519Signer,
  balanceId: string,
  callNumber: bigint,
  timestampMs: bigint,
  responseHash: Uint8Array,
): Promise<{ signature: Uint8Array; message: Uint8Array }> {
  const message = buildReceiptMessage(balanceId, callNumber, timestampMs, responseHash);
  const signature = await sign(message);
  return { signature, message };
}

/**
 * Verify a receipt signature offline (agent-side check before on-chain dispute).
 *
 * @param verify - Ed25519 verification function
 * @param signature - 64-byte Ed25519 signature
 * @param balanceId - PrepaidBalance object address
 * @param callNumber - Sequential call number
 * @param timestampMs - Unix timestamp in milliseconds
 * @param responseHash - Hash of the API response
 * @returns true if the signature is valid
 */
export async function verifyReceipt(
  verify: Ed25519Verifier,
  signature: Uint8Array,
  balanceId: string,
  callNumber: bigint,
  timestampMs: bigint,
  responseHash: Uint8Array,
): Promise<boolean> {
  const message = buildReceiptMessage(balanceId, callNumber, timestampMs, responseHash);
  return verify(message, signature);
}
