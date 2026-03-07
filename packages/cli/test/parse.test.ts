import { describe, it, expect } from "vitest";
import { resolveCoinType, parseAmount, parseDuration, validateAddress, validateObjectId, parseBigIntFlag, assertTxSuccess } from "../src/parse";
import { CliError } from "../src/context";
import { COIN_TYPES, TESTNET_COIN_TYPES } from "@sweefi/sui";

describe("resolveCoinType", () => {
  it("defaults to SUI", () => {
    expect(resolveCoinType()).toBe(COIN_TYPES.SUI);
    expect(resolveCoinType(undefined)).toBe(COIN_TYPES.SUI);
  });

  it("resolves shorthand names", () => {
    expect(resolveCoinType("SUI")).toBe(COIN_TYPES.SUI);
    expect(resolveCoinType("sui")).toBe(COIN_TYPES.SUI);
    expect(resolveCoinType("USDC", "testnet")).toBe(TESTNET_COIN_TYPES.USDC);
    expect(resolveCoinType("USDC", "mainnet")).toBe(COIN_TYPES.USDC);
  });

  it("resolves USDSUI shorthand", () => {
    expect(resolveCoinType("USDSUI")).toBe(COIN_TYPES.USDSUI);
    expect(resolveCoinType("usdsui")).toBe(COIN_TYPES.USDSUI);
  });

  it("passes through full type strings", () => {
    const custom = "0xabc::token::TOKEN";
    expect(resolveCoinType(custom)).toBe(custom);
  });

  // B3: resolveCoinType edge cases
  it("handles mixed-case shorthands (Sui, UsD, Usdc)", () => {
    expect(resolveCoinType("Sui")).toBe(COIN_TYPES.SUI);
    expect(resolveCoinType("Usdc", "mainnet")).toBe(COIN_TYPES.USDC);
  });

  it("passes through unknown coin types as-is", () => {
    expect(resolveCoinType("UNKNOWN_COIN")).toBe("UNKNOWN_COIN");
    expect(resolveCoinType("0xdeadbeef::token::FOO")).toBe("0xdeadbeef::token::FOO");
  });
});

describe("parseAmount", () => {
  const SUI = COIN_TYPES.SUI;

  it("parses whole numbers", () => {
    expect(parseAmount("1", SUI)).toBe(1_000_000_000n);
    expect(parseAmount("10", SUI)).toBe(10_000_000_000n);
  });

  it("parses decimals", () => {
    expect(parseAmount("1.5", SUI)).toBe(1_500_000_000n);
    expect(parseAmount("0.001", SUI)).toBe(1_000_000n);
  });

  it("passes through large raw integers (base units)", () => {
    expect(parseAmount("15000000000", SUI)).toBe(15_000_000_000n);
  });

  it("rejects invalid amounts", () => {
    expect(() => parseAmount("", SUI)).toThrow(CliError);
    expect(() => parseAmount("-1", SUI)).toThrow(CliError);
    expect(() => parseAmount("abc", SUI)).toThrow(CliError);
  });

  // Adversarial inputs (P1, P2, P3)
  it("rejects Infinity", () => {
    expect(() => parseAmount("Infinity", SUI)).toThrow(CliError);
    expect(() => parseAmount("-Infinity", SUI)).toThrow(CliError);
  });

  it("rejects scientific notation", () => {
    expect(() => parseAmount("1e18", SUI)).toThrow(CliError);
    expect(() => parseAmount("1.5E9", SUI)).toThrow(CliError);
  });

  it("rejects all-zeros large integer (silent zero-amount)", () => {
    expect(() => parseAmount("00000000000", SUI)).toThrow(CliError);
    expect(() => parseAmount("00000000000000", SUI)).toThrow(CliError);
  });

  it("rejects amounts with excess decimals that truncate to zero", () => {
    // 10 decimal places for a 9-decimal coin → silent truncation to 0
    expect(() => parseAmount("0.0000000001", SUI)).toThrow(CliError);
  });

  it("handles trailing dot correctly", () => {
    // "1." should parse as 1.0
    expect(parseAmount("1.", SUI)).toBe(1_000_000_000n);
  });

  it("handles minimum representable amount", () => {
    // 1 MIST = 0.000000001 SUI (9 decimal places)
    expect(parseAmount("0.000000001", SUI)).toBe(1n);
  });

  // B3: parseAmount edge cases
  it("rejects zero", () => {
    expect(() => parseAmount("0", SUI)).toThrow(CliError);
    expect(() => parseAmount("0.0", SUI)).toThrow(CliError);
  });

  it("rejects NaN literal", () => {
    expect(() => parseAmount("NaN", SUI)).toThrow(CliError);
  });

  it("rejects whitespace-only string", () => {
    expect(() => parseAmount("   ", SUI)).toThrow(CliError);
  });

  it("passes through huge integers (>10 digits, non-zero)", () => {
    // Agents compute base units themselves — pass through directly
    expect(parseAmount("99999999999999999999", SUI)).toBe(99999999999999999999n);
  });

  it("truncates excess decimals that still yield non-zero result", () => {
    // "1.1234567891" with 9 decimals — the 10th decimal is dropped, not an error
    expect(parseAmount("1.1234567891", SUI)).toBe(1_123_456_789n);
  });

  it("rejects excess decimals that truncate to zero (silent zero-amount)", () => {
    // 10 decimal places for a 9-decimal coin — whole part is 0, fraction rounds to 0
    expect(() => parseAmount("0.0000000001", SUI)).toThrow(CliError);
  });

  it("handles trailing dot as 1.0", () => {
    expect(parseAmount("1.", SUI)).toBe(1_000_000_000n);
  });
});

describe("parseDuration", () => {
  it("parses day units", () => {
    expect(parseDuration("7d")).toBe(604_800_000n);
    expect(parseDuration("1d")).toBe(86_400_000n);
  });

  it("parses hour units", () => {
    expect(parseDuration("24h")).toBe(86_400_000n);
  });

  it("parses minute units", () => {
    expect(parseDuration("30m")).toBe(1_800_000n);
  });

  it("parses raw milliseconds", () => {
    expect(parseDuration("86400000")).toBe(86_400_000n);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDuration("abc")).toThrow(CliError);
  });

  // Adversarial inputs (P4)
  it("rejects zero duration", () => {
    expect(() => parseDuration("0d")).toThrow(CliError);
    expect(() => parseDuration("0h")).toThrow(CliError);
    expect(() => parseDuration("0")).toThrow(CliError);
  });

  it("rejects negative durations", () => {
    expect(() => parseDuration("-1h")).toThrow(CliError);
  });

  // B3: parseDuration edge cases
  it("accepts fractional durations (0.5d = 12h)", () => {
    expect(parseDuration("0.5d")).toBe(43_200_000n);
  });

  it("handles very large durations without overflow (BigInt is unbounded)", () => {
    // 999999999 days = huge but valid BigInt — no overflow
    const result = parseDuration("999999999d");
    expect(result).toBeGreaterThan(0n);
    expect(typeof result).toBe("bigint");
  });
});

describe("validateAddress", () => {
  const valid = "0x0000000000000000000000000000000000000000000000000000000000000001";

  it("accepts valid Sui addresses", () => {
    expect(validateAddress(valid, "Test")).toBe(valid);
  });

  it("rejects invalid addresses", () => {
    expect(() => validateAddress("0x123", "Test")).toThrow(CliError);
    expect(() => validateAddress("not-an-address", "Test")).toThrow(CliError);
  });

  // B3: validateAddress edge cases
  it("rejects 0x + 63 hex chars (one short)", () => {
    expect(() => validateAddress("0x" + "a".repeat(63), "Test")).toThrow(CliError);
  });

  it("rejects 0x + 65 hex chars (one long)", () => {
    expect(() => validateAddress("0x" + "a".repeat(65), "Test")).toThrow(CliError);
  });

  it("accepts mixed-case hex addresses (a-f A-F)", () => {
    // "aAbBcCdD" = 8 chars, repeat(8) = 64 hex chars total — all valid [a-fA-F0-9]
    const mixedCase = "0x" + "aAbBcCdD".repeat(8);
    expect(validateAddress(mixedCase, "Test")).toBe(mixedCase);
  });

  it("rejects 0X prefix (uppercase X is not valid)", () => {
    expect(() => validateAddress("0X" + "a".repeat(64), "Test")).toThrow(CliError);
  });

  it("rejects empty string", () => {
    expect(() => validateAddress("", "Test")).toThrow(CliError);
  });
});

describe("validateObjectId", () => {
  it("accepts valid object IDs", () => {
    expect(validateObjectId("0xabc123", "Test")).toBe("0xabc123");
    const full = "0x0000000000000000000000000000000000000000000000000000000000000001";
    expect(validateObjectId(full, "Test")).toBe(full);
  });

  it("rejects invalid object IDs", () => {
    expect(() => validateObjectId("banana", "Test")).toThrow(CliError);
    expect(() => validateObjectId("0x", "Test")).toThrow(CliError);
    expect(() => validateObjectId("", "Test")).toThrow(CliError);
    expect(() => validateObjectId("0xZZZ", "Test")).toThrow(CliError);
  });
});

describe("parseBigIntFlag", () => {
  it("parses valid integers", () => {
    expect(parseBigIntFlag("100", "test")).toBe(100n);
    expect(parseBigIntFlag("0", "test")).toBe(0n);
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseBigIntFlag("abc", "test")).toThrow(CliError);
    expect(() => parseBigIntFlag("3.14", "test")).toThrow(CliError);
    expect(() => parseBigIntFlag("", "test")).toThrow(CliError);
  });

  it("enforces minimum when specified", () => {
    expect(() => parseBigIntFlag("0", "test", { min: 1n })).toThrow(CliError);
    expect(() => parseBigIntFlag("-1", "test", { min: 0n })).toThrow(CliError);
    expect(parseBigIntFlag("1", "test", { min: 1n })).toBe(1n);
  });
});

describe("assertTxSuccess", () => {
  it("passes on success", () => {
    expect(() => assertTxSuccess({ effects: { status: { status: "success" } } })).not.toThrow();
  });

  it("throws TX_OUT_OF_GAS for gas errors (retryable)", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "InsufficientGas" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("TX_OUT_OF_GAS");
      expect((e as CliError).retryable).toBe(true);
    }
  });

  it("throws TX_OBJECT_CONFLICT for concurrent access (retryable)", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "SharedObjectLockContentious" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("TX_OBJECT_CONFLICT");
      expect((e as CliError).retryable).toBe(true);
    }
  });

  it("throws TX_EXECUTION_ERROR for non-retryable failures", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "SomeOtherError" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("TX_EXECUTION_ERROR");
      expect((e as CliError).retryable).toBe(false);
    }
  });

  it("parses MoveAbort mandate expired (code 401) with requiresHumanAction", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(mandate, 401)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MANDATE_EXPIRED");
      expect((e as CliError).requiresHumanAction).toBe(true);
    }
  });

  it("parses MoveAbort mandate per-tx exceeded (code 402) — agent-recoverable", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(mandate, 402)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MANDATE_PER_TX_EXCEEDED");
      expect((e as CliError).requiresHumanAction).toBe(false);
    }
  });

  it("parses MoveAbort prepaid max calls exceeded (code 606)", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(prepaid, 606)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("PREPAID_MAX_CALLS_EXCEEDED");
    }
  });

  it("falls back to TX_EXECUTION_ERROR for unknown abort codes", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(custom, 999)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("TX_EXECUTION_ERROR");
    }
  });
});
