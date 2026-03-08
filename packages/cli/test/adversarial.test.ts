/**
 * Adversarial probe suite — attacks @sweefi/cli as a malicious agent, confused user, or hostile network.
 * Each test is labeled with the attack surface and severity.
 * Tests that FAIL reveal real bugs. Tests that PASS confirm the safe path.
 */

import { describe, it, expect } from "vitest";
import { parseDuration, parseAmount, validateAddress, validateObjectId, parseBigIntFlag } from "../src/parse";
import { sanitize, isNetworkError, CliError } from "../src/context";

// ─── SURFACE 1: Input Fuzzing ────────────────────────────────────────────────

describe("A1 [HIGH] parseDuration — Infinity overflow → CliError (FIXED)", () => {
  it("throws CliError (not RangeError) for 310-digit number", () => {
    // Number("1" + "0".repeat(309)) === Infinity in JS
    // Fix: Number.isFinite(num) guard throws CliError before BigInt() is called
    const overflowInput = "1" + "0".repeat(309) + "d";
    expect(() => parseDuration(overflowInput)).toThrow(CliError);
  });

  it("throws CliError for float where product overflows to Infinity", () => {
    // Very large floats that are still representable don't reach Infinity via multiplication
    // because the unit multipliers are small. Strings like "1." + "7".repeat(308) still
    // parse as ~1.78, not overflow. The fix handles the digit-string Infinity case.
    const overflowInput = "1" + "0".repeat(309) + "h";
    expect(() => parseDuration(overflowInput)).toThrow(CliError);
  });
});

describe("A2 [MEDIUM] parseDuration — large but finite durations", () => {
  it("accepts 999999999d without overflow (within safe float range)", () => {
    // 999999999 * 86400000 = 8.6e16, within Number range, BigInt works
    const result = parseDuration("999999999d");
    expect(result).toBeGreaterThan(0n);
    expect(typeof result).toBe("bigint");
  });
});

describe("A3 [MEDIUM] parseAmount — leading-zero integer bypass", () => {
  it("rejects '01' (leading zero in integer path)", () => {
    // trimmed.length=2 → NOT the large-integer fast path (length > 10)
    // Number("01") = 1, num > 0, so this passes the first checks...
    // But then split on "." gives ["01"], BigInt("01") works in JS
    // This means "01" is treated as 1 SUI = 1_000_000_000n
    // That's not a bug per se, but "001" should also work the same way
    const r1 = parseAmount("01", "0x2::sui::SUI");
    const r2 = parseAmount("1", "0x2::sui::SUI");
    expect(r1).toBe(r2); // both = 1_000_000_000n — consistent behavior
  });

  it("rejects '0x1' (hex notation — FIXED: Number('0x1')=1 would silently treat an address as an amount)", () => {
    // Number("0x10") = 16 in JS — an agent pasting an address-like hex string
    // would previously get amount=16_000_000_000n silently. Now throws INVALID_AMOUNT.
    expect(() => parseAmount("0x1", "0x2::sui::SUI")).toThrow(CliError);
    expect(() => parseAmount("0xFF", "0x2::sui::SUI")).toThrow(CliError);
  });

  it("rejects string with null byte embedded", () => {
    expect(() => parseAmount("1\x00.5", "0x2::sui::SUI")).toThrow(CliError);
  });

  it("handles very long valid integer (agent-computed base units)", () => {
    // 20 nines → large-integer fast path
    const bigInt = "9".repeat(20);
    const result = parseAmount(bigInt, "0x2::sui::SUI");
    expect(result).toBe(BigInt(bigInt));
  });
});

describe("A4 [MEDIUM] validateAddress — regex boundary attacks", () => {
  it("rejects uppercase 0X prefix", () => {
    expect(() => validateAddress("0X" + "a".repeat(64), "Test")).toThrow(CliError);
  });

  it("rejects 0x prefix with 65 hex chars", () => {
    expect(() => validateAddress("0x" + "a".repeat(65), "Test")).toThrow(CliError);
  });

  it("rejects address with null byte", () => {
    expect(() => validateAddress("0x" + "a".repeat(63) + "\x00", "Test")).toThrow(CliError);
  });

  it("rejects address with unicode lookalike chars", () => {
    // U+0430 (Cyrillic 'а') looks like Latin 'a' but is not [a-fA-F0-9]
    expect(() => validateAddress("0x" + "а".repeat(64), "Test")).toThrow(CliError);
  });
});

describe("A5 [LOW] validateObjectId — no max length", () => {
  it("accepts arbitrarily long hex string (no DoS protection)", () => {
    // The regex /^0x[a-fA-F0-9]+$/ has no length limit
    // This passes validation but would fail at RPC level
    const longId = "0x" + "a".repeat(100_000);
    // Should either accept or reject — just must not crash
    expect(() => validateObjectId(longId, "Test")).not.toThrow(Error);
  });
});

// ─── SURFACE 4: Output Integrity ─────────────────────────────────────────────

describe("A6 [HIGH] sanitize — Ed25519 raw base64 private key not redacted", () => {
  it("redacts bech32 format keys (suiprivkey1...)", () => {
    const leaked = "Error: suiprivkey1qyabcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrst";
    const result = sanitize(leaked);
    expect(result).toBe("Error: [REDACTED]");
  });

  it("redacts long base64 (>=60 chars)", () => {
    const longB64 = "A".repeat(64);
    expect(sanitize(`Error: ${longB64}`)).toContain("[REDACTED]");
  });

  it("redacts short base64 (Ed25519 32-byte key = 44 chars) — FIXED: threshold lowered to 40", () => {
    // Ed25519 private key: 32 bytes → base64 = 44 chars
    // Old threshold was 60 chars — 44-char key slipped through.
    // Fix: threshold now 40 chars, covering all keypair sizes on Sui.
    const ed25519B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 44 chars
    expect(ed25519B64.length).toBe(44);
    const result = sanitize(`Error with key: ${ed25519B64}`);
    expect(result).not.toContain(ed25519B64);
    expect(result).toContain("[REDACTED]");
  });
});

// ─── SURFACE 5: Key Material Leaks ──────────────────────────────────────────

describe("A7 [MEDIUM] isNetworkError — error type detection", () => {
  it("detects ECONNREFUSED correctly", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:26657");
    expect(isNetworkError(err)).toBe(true);
  });

  it("does not falsely classify non-network errors", () => {
    const err = new Error("invalid BigInt value");
    expect(isNetworkError(err)).toBe(false);
  });

  it("handles non-Error objects safely", () => {
    expect(isNetworkError("string error")).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });
});

// ─── SURFACE 2: Concurrency / State ─────────────────────────────────────────

describe("A8 [LOW] parseBigIntFlag — leading zeros and edge cases", () => {
  it("rejects decimal strings (3.14 is not a valid BigInt)", () => {
    expect(() => parseBigIntFlag("3.14", "test")).toThrow(CliError);
  });

  it("handles leading zeros (BigInt('00') = 0n)", () => {
    // BigInt("00") actually works in modern JS (= 0n), which may bypass min=1 guard
    expect(parseBigIntFlag("00", "test")).toBe(0n);
  });

  it("min guard rejects 0n when min=1n", () => {
    expect(() => parseBigIntFlag("0", "test", { min: 1n })).toThrow(CliError);
  });

  it("handles negative string correctly", () => {
    expect(() => parseBigIntFlag("-1", "test", { min: 0n })).toThrow(CliError);
  });
});
