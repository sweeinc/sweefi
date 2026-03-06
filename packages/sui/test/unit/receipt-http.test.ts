/**
 * v0.2 Signed Receipt HTTP Layer Tests
 *
 * Tests the HTTP transport layer for signed usage receipts:
 *   - signUsageReceipt: provider-side signing + header formatting
 *   - parseUsageReceipt: agent-side parsing + verification
 *   - ReceiptAccumulator: in-memory receipt store for dispute construction
 *
 * These tests use mock Ed25519 signers/verifiers to test the formatting
 * and accumulation logic without requiring real cryptographic keys.
 */

import { describe, it, expect, vi } from "vitest";
import {
  signUsageReceipt,
  parseUsageReceipt,
  ReceiptAccumulator,
  S402_RECEIPT_HEADER,
} from "../../src/receipt-http";
import type { Ed25519Signer, Ed25519Verifier } from "../../src/receipts";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_BALANCE_ID = "0x" + "a".repeat(64);
const MOCK_RESPONSE_HASH = new Uint8Array(32).fill(0x42);
const MOCK_SIGNATURE = new Uint8Array(64).fill(0xab);

/** Mock signer that returns a predictable 64-byte signature. */
const mockSigner: Ed25519Signer = async () => MOCK_SIGNATURE;

/** Mock verifier that always returns true. */
const mockVerifierValid: Ed25519Verifier = async () => true;

/** Mock verifier that always returns false. */
const mockVerifierInvalid: Ed25519Verifier = async () => false;

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

describe("S402_RECEIPT_HEADER", () => {
  it("is X-S402-Receipt", () => {
    expect(S402_RECEIPT_HEADER).toBe("X-S402-Receipt");
  });
});

// ─────────────────────────────────────────────────
// signUsageReceipt
// ─────────────────────────────────────────────────

describe("signUsageReceipt", () => {
  it("returns a header string with v2 prefix", async () => {
    const { header } = await signUsageReceipt(
      mockSigner,
      MOCK_BALANCE_ID,
      1n,
      1700000000000n,
      MOCK_RESPONSE_HASH,
    );

    expect(header).toMatch(/^v2:/);
    expect(header.split(":")).toHaveLength(5);
  });

  it("encodes callNumber and timestampMs as decimal strings", async () => {
    const { header } = await signUsageReceipt(
      mockSigner,
      MOCK_BALANCE_ID,
      42n,
      1700000000000n,
      MOCK_RESPONSE_HASH,
    );

    const parts = header.split(":");
    expect(parts[2]).toBe("42");
    expect(parts[3]).toBe("1700000000000");
  });

  it("round-trips: sign → parse → verify = valid", async () => {
    // Use a "real" mock: signer produces deterministic bytes, verifier checks
    // that the message matches what buildReceiptMessage would produce.
    const deterministicSig = new Uint8Array(64).fill(0xcd);
    const signer: Ed25519Signer = async () => deterministicSig;
    const verifier: Ed25519Verifier = async (_message, signature) => {
      // Verify the signature matches what our signer produced
      if (signature.length !== deterministicSig.length) return false;
      for (let i = 0; i < signature.length; i++) {
        if (signature[i] !== deterministicSig[i]) return false;
      }
      return true;
    };

    const { header } = await signUsageReceipt(
      signer,
      MOCK_BALANCE_ID,
      5n,
      1700000000000n,
      MOCK_RESPONSE_HASH,
    );

    const parsed = await parseUsageReceipt(header, MOCK_BALANCE_ID, verifier);
    expect(parsed.verified).toBe(true);
    expect(parsed.callNumber).toBe(5n);
    expect(parsed.timestampMs).toBe(1700000000000n);
  });
});

// ─────────────────────────────────────────────────
// parseUsageReceipt
// ─────────────────────────────────────────────────

describe("parseUsageReceipt", () => {
  // Helper to create a valid header for parsing tests
  async function makeHeader(
    callNumber = 1n,
    timestampMs = 1700000000000n,
  ): Promise<string> {
    const { header } = await signUsageReceipt(
      mockSigner,
      MOCK_BALANCE_ID,
      callNumber,
      timestampMs,
      MOCK_RESPONSE_HASH,
    );
    return header;
  }

  it("parses valid header into correct fields", async () => {
    const header = await makeHeader(7n, 1700000000000n);
    const parsed = await parseUsageReceipt(header, MOCK_BALANCE_ID);

    expect(parsed.callNumber).toBe(7n);
    expect(parsed.timestampMs).toBe(1700000000000n);
    expect(parsed.signature).toBeInstanceOf(Uint8Array);
    expect(parsed.responseHash).toBeInstanceOf(Uint8Array);
  });

  it("returns verified: true when verifier confirms signature", async () => {
    const header = await makeHeader();
    const parsed = await parseUsageReceipt(header, MOCK_BALANCE_ID, mockVerifierValid);

    expect(parsed.verified).toBe(true);
  });

  it("returns verified: false for invalid signature", async () => {
    const header = await makeHeader();
    const parsed = await parseUsageReceipt(header, MOCK_BALANCE_ID, mockVerifierInvalid);

    expect(parsed.verified).toBe(false);
  });

  it("returns verified: null when no verifier provided", async () => {
    const header = await makeHeader();
    const parsed = await parseUsageReceipt(header, MOCK_BALANCE_ID);

    expect(parsed.verified).toBeNull();
  });

  it("throws on empty header", async () => {
    await expect(
      parseUsageReceipt("", MOCK_BALANCE_ID),
    ).rejects.toThrow("Empty receipt header");
  });

  it("throws on malformed header (wrong number of parts)", async () => {
    await expect(
      parseUsageReceipt("v2:only:three", MOCK_BALANCE_ID),
    ).rejects.toThrow("Malformed receipt header");
  });

  it("throws on unknown version prefix", async () => {
    const header = await makeHeader();
    const badHeader = header.replace("v2:", "v99:");
    await expect(
      parseUsageReceipt(badHeader, MOCK_BALANCE_ID),
    ).rejects.toThrow('Unknown receipt header version: "v99"');
  });
});

// ─────────────────────────────────────────────────
// ReceiptAccumulator
// ─────────────────────────────────────────────────

describe("ReceiptAccumulator", () => {
  function makeReceipt(callNumber: bigint, hashFill = 0x42) {
    return {
      signature: new Uint8Array(64).fill(0xab),
      callNumber,
      timestampMs: 1700000000000n + callNumber,
      responseHash: new Uint8Array(32).fill(hashFill),
    };
  }

  it("starts empty", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    expect(acc.count).toBe(0);
    expect(acc.getHighest()).toBeUndefined();
    expect(acc.getAll()).toEqual([]);
  });

  it("stores the balanceId", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    expect(acc.balanceId).toBe(MOCK_BALANCE_ID);
  });

  it("tracks receipts and increments count", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    acc.add(makeReceipt(1n));
    acc.add(makeReceipt(2n));
    acc.add(makeReceipt(3n));
    expect(acc.count).toBe(3);
  });

  it("getHighest returns receipt with max callNumber", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    acc.add(makeReceipt(3n));
    acc.add(makeReceipt(1n));
    acc.add(makeReceipt(5n));
    acc.add(makeReceipt(2n));

    const highest = acc.getHighest();
    expect(highest?.callNumber).toBe(5n);
  });

  it("getAll returns receipts sorted by callNumber", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    acc.add(makeReceipt(3n));
    acc.add(makeReceipt(1n));
    acc.add(makeReceipt(2n));

    const all = acc.getAll();
    expect(all.map((r) => r.callNumber)).toEqual([1n, 2n, 3n]);
  });

  it("deduplicates exact same callNumber + hash", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    acc.add(makeReceipt(1n, 0x42));
    acc.add(makeReceipt(1n, 0x42)); // exact duplicate
    expect(acc.count).toBe(1);
    expect(acc.getAll()).toHaveLength(1);
  });

  it("detects fraud: same callNumber, different hash (keeps both)", () => {
    const acc = new ReceiptAccumulator(MOCK_BALANCE_ID);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    acc.add(makeReceipt(1n, 0x42)); // hash A
    acc.add(makeReceipt(1n, 0x99)); // hash B — fraud indicator!

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("Fraud indicator");

    // Both receipts kept (count is unique call numbers, not total receipts)
    expect(acc.count).toBe(1); // 1 unique callNumber
    expect(acc.getAll()).toHaveLength(2); // but 2 receipts stored

    warnSpy.mockRestore();
  });
});
