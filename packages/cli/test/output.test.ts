import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { outputSuccess, outputError, formatBalance, explorerUrl, getSymbol, createRequestContext, computeGas, VERSION } from "../src/output";
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

describe("createRequestContext", () => {
  it("creates a context with UUID and timing", () => {
    const reqCtx = createRequestContext("testnet");
    expect(reqCtx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reqCtx.network).toBe("testnet");
    expect(typeof reqCtx.startTime).toBe("number");
  });
});

describe("computeGas", () => {
  it("computes gas from transaction effects", () => {
    const result = {
      effects: {
        gasUsed: {
          computationCost: "1000000",
          storageCost: "500000",
          storageRebate: "200000",
        },
      },
    };
    const gas = computeGas(result);
    expect(gas).toBeDefined();
    expect(gas!.mist).toBe(1300000);
    expect(gas!.display).toBe("0.001300 SUI");
  });

  it("returns undefined when no gas info", () => {
    expect(computeGas({ effects: null })).toBeUndefined();
    expect(computeGas({ effects: { gasUsed: undefined } })).toBeUndefined();
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

  it("outputs valid JSON envelope with meta block", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("test", { foo: "bar" }, false, reqCtx);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("test");
    expect(parsed.version).toBe(VERSION);
    expect(parsed.data.foo).toBe("bar");
    // meta block
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.network).toBe("testnet");
    expect(parsed.meta.cliVersion).toBe(VERSION);
    expect(parsed.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof parsed.meta.durationMs).toBe("number");
  });

  it("includes gas in meta when provided", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay", { txDigest: "abc" }, false, reqCtx, { mist: 1420000, display: "0.001420 SUI" });
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.meta.gasCostMist).toBe(1420000);
    expect(parsed.meta.gasCostDisplay).toBe("0.001420 SUI");
  });

  it("outputs human-readable format", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("test", { key: "value" }, true, reqCtx);
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

  it("outputs structured error JSON with meta", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NO_WALLET", "No wallet configured", false, "Set SUI_PRIVATE_KEY", false, reqCtx);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NO_WALLET");
    expect(parsed.error.suggestedAction).toBe("Set SUI_PRIVATE_KEY");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.network).toBe("testnet");
  });

  it("includes retryAfterMs when provided", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NETWORK_ERROR", "RPC unreachable", true, "Retry later", false, reqCtx, 30000);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.retryAfterMs).toBe(30000);
  });

  it("works without reqCtx (fallback meta)", () => {
    outputError("pay", "NO_WALLET", "No wallet configured");
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.network).toBe("unknown");
  });
});
