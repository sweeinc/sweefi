import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { outputSuccess, outputError, formatBalance, explorerUrl, getSymbol } from "../src/output";
import { COIN_TYPES } from "@sweefi/sui";

describe("formatBalance", () => {
  it("formats SUI (9 decimals)", () => {
    expect(formatBalance("1500000000", COIN_TYPES.SUI)).toBe("1.5 SUI");
    expect(formatBalance("1000000000", COIN_TYPES.SUI)).toBe("1.0 SUI");
    expect(formatBalance("100000", COIN_TYPES.SUI)).toBe("0.0001 SUI");
  });

  it("formats zero correctly", () => {
    expect(formatBalance("0", COIN_TYPES.SUI)).toBe("0.0 SUI");
  });
});

describe("explorerUrl", () => {
  it("generates testnet URLs", () => {
    expect(explorerUrl("testnet", "ABC123")).toBe("https://suiscan.xyz/testnet/tx/ABC123");
  });

  it("generates mainnet URLs", () => {
    expect(explorerUrl("mainnet", "ABC123")).toBe("https://suiscan.xyz/mainnet/tx/ABC123");
  });
});

describe("getSymbol", () => {
  it("resolves known types", () => {
    expect(getSymbol(COIN_TYPES.SUI)).toBe("SUI");
    expect(getSymbol(COIN_TYPES.USDC)).toBe("USDC");
  });

  it("truncates unknown types", () => {
    const long = "0xabcdef1234567890abcdef1234567890::module::TOKEN";
    expect(getSymbol(long).length).toBeLessThan(long.length);
  });
});

describe("outputSuccess", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("outputs valid JSON envelope", () => {
    outputSuccess("test", { foo: "bar" }, false);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("test");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.data.foo).toBe("bar");
  });

  it("outputs human-readable format", () => {
    outputSuccess("test", { key: "value" }, true);
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("test successful");
    expect(output).toContain("value");
  });
});

describe("outputError", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("outputs structured error JSON", () => {
    outputError("pay", "NO_WALLET", "No wallet configured", false, "Set SUI_PRIVATE_KEY");
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NO_WALLET");
    expect(parsed.error.suggestedAction).toBe("Set SUI_PRIVATE_KEY");
  });
});
