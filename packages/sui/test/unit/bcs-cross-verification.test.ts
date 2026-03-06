/**
 * BCS Cross-Layer Verification Tests
 *
 * Verifies that TypeScript's buildReceiptMessage() produces the EXACT same
 * bytes as Move's dispute_claim() would reconstruct using bcs::to_bytes().
 *
 * This is the single most critical test in the receipt system: if these
 * encodings diverge, fraud proofs silently fail on-chain.
 *
 * Move reconstruction (from contracts/sources/prepaid.move):
 *   let mut msg = vector[];
 *   msg.append(bcs::to_bytes(&receipt_balance_id));       // address: 32 bytes raw
 *   msg.append(bcs::to_bytes(&receipt_call_number));       // u64: 8 bytes LE
 *   msg.append(bcs::to_bytes(&receipt_timestamp_ms));      // u64: 8 bytes LE
 *   msg.append(bcs::to_bytes(&receipt_response_hash));     // vector<u8>: ULEB128 len + bytes
 */

import { describe, it, expect } from "vitest";
import { buildReceiptMessage } from "../../src/receipts";

// ── Test vectors with hand-computed expected bytes ───

// Known inputs
const BALANCE_ID = "0x" + "0a".repeat(32); // 32 bytes of 0x0a
const CALL_NUMBER = 5n;
const TIMESTAMP_MS = 1709251200000n; // 2024-03-01T00:00:00Z
const RESPONSE_HASH = new Uint8Array([
  0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
]);

describe("BCS cross-layer verification", () => {
  describe("bcsAddress (Move bcs::to_bytes(&address))", () => {
    it("produces exactly 32 bytes with no length prefix", () => {
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 0n, new Uint8Array(0));
      // First 32 bytes = address
      const addressBytes = msg.slice(0, 32);
      expect(addressBytes.length).toBe(32);
      // Every byte should be 0x0a
      for (let i = 0; i < 32; i++) {
        expect(addressBytes[i]).toBe(0x0a);
      }
    });

    it("rejects address with wrong length", () => {
      expect(() =>
        buildReceiptMessage("0x" + "ab".repeat(31), 0n, 0n, new Uint8Array(0)),
      ).toThrow("Address must be 64 hex chars");
    });
  });

  describe("bcsU64 (Move bcs::to_bytes(&u64))", () => {
    it("encodes 5 as 8-byte little-endian", () => {
      const msg = buildReceiptMessage(BALANCE_ID, 5n, 0n, new Uint8Array(0));
      // Bytes 32-39 = call_number
      const callBytes = msg.slice(32, 40);
      expect(callBytes).toEqual(
        new Uint8Array([0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      );
    });

    it("encodes timestamp 1709251200000 as 8-byte little-endian", () => {
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 1709251200000n, new Uint8Array(0));
      // Bytes 40-47 = timestamp_ms
      const tsBytes = msg.slice(40, 48);
      // 1709251200000 = 0x18DFA94C400 → LE: 00 C4 4C A9 DF 18 01 00
      // Let's compute: 1709251200000 in hex
      const expected = new Uint8Array(8);
      const view = new DataView(expected.buffer);
      view.setBigUint64(0, 1709251200000n, true);
      expect(tsBytes).toEqual(expected);
    });

    it("encodes u64 max correctly", () => {
      const maxU64 = 2n ** 64n - 1n; // 18446744073709551615
      const msg = buildReceiptMessage(BALANCE_ID, maxU64, 0n, new Uint8Array(0));
      const callBytes = msg.slice(32, 40);
      expect(callBytes).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    });

    it("encodes 0 as 8 zero bytes", () => {
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 0n, new Uint8Array(0));
      const callBytes = msg.slice(32, 40);
      expect(callBytes).toEqual(new Uint8Array(8));
    });
  });

  describe("bcsVectorU8 (Move bcs::to_bytes(&vector<u8>))", () => {
    it("prefixes with ULEB128 length for 32-byte hash", () => {
      const hash = new Uint8Array(32).fill(0xab);
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 0n, hash);
      // Bytes 48+ = vector<u8>(response_hash)
      // ULEB128(32) = 0x20 (single byte, since 32 < 128)
      expect(msg[48]).toBe(32); // ULEB128 length prefix
      expect(msg.length).toBe(32 + 8 + 8 + 1 + 32); // 81 total
      // Payload bytes follow the prefix
      for (let i = 0; i < 32; i++) {
        expect(msg[49 + i]).toBe(0xab);
      }
    });

    it("handles empty vector (length prefix = 0)", () => {
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 0n, new Uint8Array(0));
      // ULEB128(0) = 0x00
      expect(msg[48]).toBe(0);
      expect(msg.length).toBe(32 + 8 + 8 + 1); // 49 total
    });

    it("handles 128-byte vector with 2-byte ULEB128 prefix", () => {
      const largeHash = new Uint8Array(128).fill(0xcc);
      const msg = buildReceiptMessage(BALANCE_ID, 0n, 0n, largeHash);
      // ULEB128(128) = 0x80 0x01 (two bytes: 128 in ULEB128)
      expect(msg[48]).toBe(0x80);
      expect(msg[49]).toBe(0x01);
      expect(msg.length).toBe(32 + 8 + 8 + 2 + 128); // 178 total
    });
  });

  describe("full message byte-for-byte verification", () => {
    it("matches expected BCS output for known inputs", () => {
      const msg = buildReceiptMessage(
        BALANCE_ID,
        CALL_NUMBER,
        TIMESTAMP_MS,
        RESPONSE_HASH,
      );

      // ── Build expected bytes manually ──

      // 1. address: 32 bytes of 0x0a (no BCS length prefix for fixed-size)
      const expectedAddress = new Uint8Array(32).fill(0x0a);

      // 2. u64 call_number = 5: little-endian 8 bytes
      const expectedCall = new Uint8Array([
        0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      // 3. u64 timestamp_ms = 1709251200000: little-endian 8 bytes
      const expectedTs = new Uint8Array(8);
      new DataView(expectedTs.buffer).setBigUint64(0, 1709251200000n, true);

      // 4. vector<u8> response_hash: ULEB128(32) + 32 bytes
      const expectedHash = new Uint8Array(1 + 32);
      expectedHash[0] = 32; // ULEB128 length prefix
      expectedHash.set(RESPONSE_HASH, 1);

      // Concatenate expected
      const expected = new Uint8Array(
        expectedAddress.length +
          expectedCall.length +
          expectedTs.length +
          expectedHash.length,
      );
      let offset = 0;
      expected.set(expectedAddress, offset);
      offset += expectedAddress.length;
      expected.set(expectedCall, offset);
      offset += expectedCall.length;
      expected.set(expectedTs, offset);
      offset += expectedTs.length;
      expected.set(expectedHash, offset);

      // Byte-for-byte comparison
      expect(msg.length).toBe(expected.length);
      expect(msg).toEqual(expected);

      // Cross-check total size: 32 + 8 + 8 + (1 + 32) = 81
      expect(msg.length).toBe(81);
    });

    it("field order is address → call_number → timestamp → response_hash", () => {
      // Use distinct patterns in each field to verify ordering
      const distinctId = "0x" + "11".repeat(32);
      const distinctHash = new Uint8Array(4).fill(0x44);
      const msg = buildReceiptMessage(distinctId, 0x22n, 0x33n, distinctHash);

      // Address at offset 0: 32 bytes of 0x11
      expect(msg[0]).toBe(0x11);
      expect(msg[31]).toBe(0x11);

      // call_number at offset 32: 0x22 LE
      expect(msg[32]).toBe(0x22);
      expect(msg[33]).toBe(0x00);

      // timestamp at offset 40: 0x33 LE
      expect(msg[40]).toBe(0x33);
      expect(msg[41]).toBe(0x00);

      // response_hash at offset 48: ULEB128(4) = 0x04, then 4 bytes of 0x44
      expect(msg[48]).toBe(0x04); // length prefix
      expect(msg[49]).toBe(0x44);
      expect(msg[52]).toBe(0x44);
    });
  });
});
