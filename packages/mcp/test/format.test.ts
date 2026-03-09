import { describe, it, expect } from "vitest";
import { formatBalance, getSymbol, resolveCoinType, parseAmount, parseAmountOrZero, assertTxSuccess } from "../src/utils/format.js";
import { COIN_TYPES, TESTNET_COIN_TYPES } from "@sweefi/sui";

describe("formatBalance", () => {
  it("formats SUI from MIST correctly", () => {
    const result = formatBalance("1000000000", COIN_TYPES.SUI);
    expect(result).toBe("1.0 SUI");
  });

  it("formats zero balance", () => {
    const result = formatBalance("0", COIN_TYPES.SUI);
    expect(result).toBe("0.0 SUI");
  });

  it("formats fractional SUI", () => {
    const result = formatBalance("1500000000", COIN_TYPES.SUI);
    expect(result).toBe("1.5 SUI");
  });

  it("formats USDC with 6 decimals", () => {
    const result = formatBalance("1000000", COIN_TYPES.USDC);
    expect(result).toBe("1.0 USDC");
  });
});

describe("getSymbol", () => {
  it("returns SUI for SUI type", () => {
    expect(getSymbol(COIN_TYPES.SUI)).toBe("SUI");
  });

  it("returns USDC for USDC type", () => {
    expect(getSymbol(COIN_TYPES.USDC)).toBe("USDC");
  });
});

describe("resolveCoinType", () => {
  it("defaults to SUI when no input", () => {
    expect(resolveCoinType()).toBe(COIN_TYPES.SUI);
  });

  it("resolves SUI string", () => {
    expect(resolveCoinType("SUI")).toBe(COIN_TYPES.SUI);
  });

  it("resolves USDC to mainnet address by default", () => {
    expect(resolveCoinType("usdc")).toBe(COIN_TYPES.USDC);
  });

  it("resolves USDC to mainnet address when network is mainnet", () => {
    expect(resolveCoinType("usdc", "mainnet")).toBe(COIN_TYPES.USDC);
  });

  it("resolves USDC to testnet address when network includes testnet", () => {
    expect(resolveCoinType("usdc", "testnet")).toBe(TESTNET_COIN_TYPES.USDC);
    expect(resolveCoinType("USDC", "sui:testnet")).toBe(TESTNET_COIN_TYPES.USDC);
  });

  it("resolves USDSUI to mainnet address", () => {
    expect(resolveCoinType("usdsui")).toBe(COIN_TYPES.USDSUI);
    expect(resolveCoinType("USDSUI")).toBe(COIN_TYPES.USDSUI);
  });

  it("passes through full type strings", () => {
    const custom = "0xabc::token::TOKEN";
    expect(resolveCoinType(custom)).toBe(custom);
  });
});

describe("parseAmount", () => {
  it("parses valid integer strings", () => {
    expect(parseAmount("1000000000")).toBe(1000000000n);
    expect(parseAmount("1")).toBe(1n);
  });

  it("rejects empty strings", () => {
    expect(() => parseAmount("")).toThrow("amount is required");
    expect(() => parseAmount("  ")).toThrow("amount is required");
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseAmount("abc")).toThrow("must be a non-negative integer");
    expect(() => parseAmount("1.5")).toThrow("must be a non-negative integer");
    expect(() => parseAmount("-100")).toThrow("must be a non-negative integer");
  });

  it("rejects zero", () => {
    expect(() => parseAmount("0")).toThrow("must be greater than zero");
  });

  it("uses custom field name in error messages", () => {
    expect(() => parseAmount("abc", "depositAmount")).toThrow("depositAmount must be a non-negative integer");
  });

  it("trims whitespace before parsing", () => {
    expect(parseAmount("  1000  ")).toBe(1000n);
  });

  it("rejects values exceeding u64 max", () => {
    const tooLarge = "18446744073709551616"; // u64::MAX + 1
    expect(() => parseAmount(tooLarge)).toThrow("exceeds u64::MAX");
  });

  it("accepts u64 max exactly", () => {
    expect(parseAmount("18446744073709551615")).toBe(18446744073709551615n);
  });
});

describe("parseAmountOrZero", () => {
  it("allows zero values", () => {
    expect(parseAmountOrZero("0")).toBe(0n);
  });

  it("parses valid positive integers", () => {
    expect(parseAmountOrZero("1000000000")).toBe(1000000000n);
    expect(parseAmountOrZero("1")).toBe(1n);
  });

  it("rejects empty strings", () => {
    expect(() => parseAmountOrZero("")).toThrow("amount is required");
  });

  it("rejects negative numbers", () => {
    expect(() => parseAmountOrZero("-100")).toThrow("must be a non-negative integer");
  });

  it("rejects hex strings", () => {
    expect(() => parseAmountOrZero("0xff")).toThrow("must be a non-negative integer");
  });

  it("rejects floats", () => {
    expect(() => parseAmountOrZero("1.5")).toThrow("must be a non-negative integer");
  });

  it("rejects garbage strings", () => {
    expect(() => parseAmountOrZero("abc")).toThrow("must be a non-negative integer");
  });

  it("rejects values exceeding u64 max", () => {
    const tooLarge = "18446744073709551616"; // u64::MAX + 1
    expect(() => parseAmountOrZero(tooLarge)).toThrow("exceeds u64::MAX");
  });

  it("accepts u64 max exactly", () => {
    expect(parseAmountOrZero("18446744073709551615")).toBe(18446744073709551615n);
  });

  it("uses custom field name in errors", () => {
    expect(() => parseAmountOrZero("abc", "dailyLimit")).toThrow("dailyLimit must be a non-negative integer");
  });
});

describe("assertTxSuccess", () => {
  it("does nothing for successful transactions", () => {
    expect(() =>
      assertTxSuccess({ effects: { status: { status: "success" } } }),
    ).not.toThrow();
  });

  it("throws for failed transactions", () => {
    expect(() =>
      assertTxSuccess({
        effects: { status: { status: "failure", error: "InsufficientGas" } },
      }),
    ).toThrow("Transaction failed on-chain: InsufficientGas");
  });

  it("throws with unknown error when no error message", () => {
    expect(() =>
      assertTxSuccess({ effects: { status: { status: "failure" } } }),
    ).toThrow("Transaction failed on-chain: Unknown error");
  });

  it("throws when effects are missing", () => {
    expect(() => assertTxSuccess({ effects: null })).toThrow("Transaction failed on-chain");
  });

  it("parses MoveAbort mandate revoked (code 405) with structured JSON", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(mandate, 405)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("MANDATE_REVOKED");
      expect(msg).toContain("requiresHumanAction");
      // Verify the embedded JSON is parseable
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("MANDATE_REVOKED");
      expect(parsed.requiresHumanAction).toBe(true);
      expect(parsed.retryable).toBe(false);
    }
  });

  it("parses MoveAbort mandate per-tx exceeded (code 402) as agent-recoverable", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(mandate, 402)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("MANDATE_PER_TX_EXCEEDED");
      expect(parsed.requiresHumanAction).toBe(false);
    }
  });

  it("falls back to TX_FAILED with JSON for unknown abort codes", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(custom, 999)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("TX_FAILED");
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("TX_FAILED");
    }
  });

  it("parses stream abort code (106 = nothing to claim) as retryable", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(stream, 106)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("STREAM_NOTHING_TO_CLAIM");
      expect(parsed.retryable).toBe(true);
      expect(parsed.requiresHumanAction).toBe(false);
    }
  });

  it("parses escrow abort code (206 = already resolved) as non-retryable", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(escrow, 206)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("ESCROW_ALREADY_RESOLVED");
      expect(parsed.retryable).toBe(false);
    }
  });

  it("parses prepaid abort code (604 = withdrawal locked) as retryable", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(prepaid, 604)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("PREPAID_WITHDRAWAL_LOCKED");
      expect(parsed.retryable).toBe(true);
    }
  });

  it("parses agent_mandate abort code (559 = level not authorized) as human-required", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(agent_mandate, 559)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("AGENT_MANDATE_LEVEL_NOT_AUTHORIZED");
      expect(parsed.requiresHumanAction).toBe(true);
    }
  });

  it("parses payment abort code (0 = insufficient payment)", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "MoveAbort(payment, 0)" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("INSUFFICIENT_PAYMENT");
    }
  });

  it("includes JSON in generic failure errors", () => {
    try {
      assertTxSuccess({ effects: { status: { status: "failure", error: "InsufficientGas" } } });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      const jsonPart = msg.slice(msg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      expect(parsed.code).toBe("TX_FAILED");
      expect(parsed.suggestedAction).toContain("explorer");
    }
  });
});
