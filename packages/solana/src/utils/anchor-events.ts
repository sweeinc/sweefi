/**
 * Anchor Event Parser
 *
 * Extracts and decodes Anchor events from Solana transaction logs.
 * Anchor emits events as "Program data: <base64>" entries in transaction logs.
 * The data is prefixed with an 8-byte discriminator (sha256("event:<EventName>")[0..8]),
 * followed by borsh-serialized fields.
 *
 * SECURITY: Program ID verification is critical for anti-spoofing. Without it,
 * an attacker can deploy their own program that emits identically-named events
 * and pass facilitator verification.
 */

import { sha256 } from '@noble/hashes/sha256';
import { base64ToUint8Array } from './encoding.js';

// ─── Event discriminators (sha256("event:<EventName>")[0..8]) ────────────────

/**
 * Compute Anchor event discriminator.
 * Anchor uses sha256("event:<EventName>")[0..8] as a prefix for event data.
 */
function eventDiscriminator(eventName: string): Uint8Array {
  const hash = sha256(`event:${eventName}`);
  return hash.slice(0, 8);
}

// Pre-computed discriminators for performance
const DISCRIMINATORS = {
  PrepaidDeposited: eventDiscriminator('PrepaidDeposited'),
  StreamCreated: eventDiscriminator('StreamCreated'),
  EscrowCreated: eventDiscriminator('EscrowCreated'),
  UptoDepositCreated: eventDiscriminator('UptoDepositCreated'),
} as const;

// ─── Event data structures ───────────────────────────────────────────────────

export interface PrepaidDepositedEvent {
  balance: string;     // Pubkey (base58)
  agent: string;       // Pubkey
  provider: string;    // Pubkey
  amount: bigint;      // u64
  ratePerCall: bigint; // u64
  maxCalls: bigint;    // u64
  timestamp: bigint;   // i64
}

export interface StreamCreatedEvent {
  meter: string;         // Pubkey
  payer: string;         // Pubkey
  recipient: string;     // Pubkey
  deposit: bigint;       // u64
  ratePerSecond: bigint; // u64
  budgetCap: bigint;     // u64
  timestamp: bigint;     // i64
}

export interface EscrowCreatedEvent {
  escrow: string;    // Pubkey
  buyer: string;     // Pubkey
  seller: string;    // Pubkey
  arbiter: string;   // Pubkey
  amount: bigint;    // u64
  deadline: bigint;  // i64
  timestamp: bigint; // i64
}

export interface UptoDepositCreatedEvent {
  deposit: string;           // Pubkey
  payer: string;             // Pubkey
  recipient: string;         // Pubkey
  mint: string;              // Pubkey
  maxAmount: bigint;         // u64
  settlementCeiling: bigint; // u64
  settlementDeadline: bigint; // i64
  feeBps: number;            // u16
  timestamp: bigint;         // i64
}

// ─── Log parsing helpers ─────────────────────────────────────────────────────

/**
 * Extract "Program data:" entries from transaction logs and return
 * the decoded bytes along with the program ID that emitted them.
 *
 * Anchor logs follow this pattern:
 *   "Program <program_id> invoke [1]"
 *   ... instructions ...
 *   "Program data: <base64>"
 *   "Program <program_id> success"
 *
 * We track the current program context to associate data with the right program.
 */
interface ProgramDataEntry {
  programId: string;
  data: Uint8Array;
}

function extractProgramData(logs: string[]): ProgramDataEntry[] {
  const entries: ProgramDataEntry[] = [];
  const programStack: string[] = [];

  for (const log of logs) {
    // Track program invocations
    const invokeMatch = log.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invokeMatch) {
      programStack.push(invokeMatch[1]);
      continue;
    }

    // Track program exits
    if (log.match(/^Program \w+ (success|failed)$/)) {
      programStack.pop();
      continue;
    }

    // Extract event data
    const dataMatch = log.match(/^Program data: (.+)$/);
    if (dataMatch && programStack.length > 0) {
      const programId = programStack[programStack.length - 1];
      const data = base64ToUint8Array(dataMatch[1]);
      entries.push({ programId, data });
    }
  }

  return entries;
}

/**
 * Check if data starts with the expected discriminator.
 */
function matchesDiscriminator(data: Uint8Array, discriminator: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== discriminator[i]) return false;
  }
  return true;
}

// ─── Borsh deserialization helpers ───────────────────────────────────────────

/**
 * Simple borsh decoder for our event types.
 * Fields are read in order: Pubkey (32 bytes), u64 (8 bytes LE), i64 (8 bytes LE signed), u16 (2 bytes LE).
 *
 * SECURITY: All reads are bounds-checked. Malformed/truncated event data throws
 * rather than reading garbage or causing undefined behavior.
 */
class BorshReader {
  private offset = 8; // Skip discriminator

  constructor(private readonly data: Uint8Array) {
    // Minimum: 8-byte discriminator
    if (data.length < 8) {
      throw new Error(`Event data too short: ${data.length} bytes, minimum 8`);
    }
  }

  /** Ensure we have at least `n` bytes remaining before reading. */
  private assertRemaining(n: number, fieldName: string): void {
    if (this.offset + n > this.data.length) {
      throw new Error(
        `Truncated event: reading ${fieldName} requires ${n} bytes at offset ${this.offset}, ` +
        `but data is only ${this.data.length} bytes`
      );
    }
  }

  /** Read a 32-byte Pubkey and return as base58. */
  pubkey(): string {
    this.assertRemaining(32, 'pubkey');
    const bytes = this.data.slice(this.offset, this.offset + 32);
    this.offset += 32;
    return bytesToBase58(bytes);
  }

  /** Read u64 (little-endian). */
  u64(): bigint {
    this.assertRemaining(8, 'u64');
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    this.offset += 8;
    return view.getBigUint64(0, true);
  }

  /** Read i64 (little-endian, signed). */
  i64(): bigint {
    this.assertRemaining(8, 'i64');
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    this.offset += 8;
    return view.getBigInt64(0, true);
  }

  /** Read u16 (little-endian). */
  u16(): number {
    this.assertRemaining(2, 'u16');
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 2);
    this.offset += 2;
    return view.getUint16(0, true);
  }
}

// Base58 alphabet (Bitcoin-style, used by Solana)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Convert 32-byte Pubkey to base58 string.
 * Minimal implementation — no external dependency.
 */
function bytesToBase58(bytes: Uint8Array): string {
  // Convert bytes to a big integer
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  // Convert to base58
  let result = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = BASE58_ALPHABET[remainder] + result;
  }

  // Handle leading zeros
  for (const byte of bytes) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result || '1';
}

// ─── Event extraction functions ──────────────────────────────────────────────

export interface ExtractedEvent<T> {
  programId: string;
  event: T;
}

/**
 * Extract PrepaidDeposited event from transaction logs.
 *
 * @param logs - Transaction logs from simulation or execution
 * @param expectedProgramId - Expected program ID for anti-spoofing (required)
 * @returns The event data if found and from the expected program, null otherwise
 */
export function extractPrepaidDepositedEvent(
  logs: string[],
  expectedProgramId: string,
): PrepaidDepositedEvent | null {
  const entries = extractProgramData(logs);

  for (const entry of entries) {
    // Anti-spoofing: only accept events from our program
    if (entry.programId !== expectedProgramId) continue;

    if (!matchesDiscriminator(entry.data, DISCRIMINATORS.PrepaidDeposited)) continue;

    const reader = new BorshReader(entry.data);
    return {
      balance: reader.pubkey(),
      agent: reader.pubkey(),
      provider: reader.pubkey(),
      amount: reader.u64(),
      ratePerCall: reader.u64(),
      maxCalls: reader.u64(),
      timestamp: reader.i64(),
    };
  }

  return null;
}

/**
 * Extract StreamCreated event from transaction logs.
 */
export function extractStreamCreatedEvent(
  logs: string[],
  expectedProgramId: string,
): StreamCreatedEvent | null {
  const entries = extractProgramData(logs);

  for (const entry of entries) {
    if (entry.programId !== expectedProgramId) continue;
    if (!matchesDiscriminator(entry.data, DISCRIMINATORS.StreamCreated)) continue;

    const reader = new BorshReader(entry.data);
    return {
      meter: reader.pubkey(),
      payer: reader.pubkey(),
      recipient: reader.pubkey(),
      deposit: reader.u64(),
      ratePerSecond: reader.u64(),
      budgetCap: reader.u64(),
      timestamp: reader.i64(),
    };
  }

  return null;
}

/**
 * Extract EscrowCreated event from transaction logs.
 */
export function extractEscrowCreatedEvent(
  logs: string[],
  expectedProgramId: string,
): EscrowCreatedEvent | null {
  const entries = extractProgramData(logs);

  for (const entry of entries) {
    if (entry.programId !== expectedProgramId) continue;
    if (!matchesDiscriminator(entry.data, DISCRIMINATORS.EscrowCreated)) continue;

    const reader = new BorshReader(entry.data);
    return {
      escrow: reader.pubkey(),
      buyer: reader.pubkey(),
      seller: reader.pubkey(),
      arbiter: reader.pubkey(),
      amount: reader.u64(),
      deadline: reader.i64(),
      timestamp: reader.i64(),
    };
  }

  return null;
}

/**
 * Extract UptoDepositCreated event from transaction logs.
 */
export function extractUptoDepositCreatedEvent(
  logs: string[],
  expectedProgramId: string,
): UptoDepositCreatedEvent | null {
  const entries = extractProgramData(logs);

  for (const entry of entries) {
    if (entry.programId !== expectedProgramId) continue;
    if (!matchesDiscriminator(entry.data, DISCRIMINATORS.UptoDepositCreated)) continue;

    const reader = new BorshReader(entry.data);
    return {
      deposit: reader.pubkey(),
      payer: reader.pubkey(),
      recipient: reader.pubkey(),
      mint: reader.pubkey(),
      maxAmount: reader.u64(),
      settlementCeiling: reader.u64(),
      settlementDeadline: reader.i64(),
      feeBps: reader.u16(),
      timestamp: reader.i64(),
    };
  }

  return null;
}
