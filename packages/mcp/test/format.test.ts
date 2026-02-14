import { describe, it, expect } from "vitest";
import { formatBalance, getSymbol, resolveCoinType, parseAmount, assertTxSuccess } from "../src/utils/format.js";
import { COIN_TYPES } from "@sweepay/core";

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

  it("resolves USDC string (case insensitive)", () => {
    expect(resolveCoinType("usdc")).toBe(COIN_TYPES.USDC);
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
});
