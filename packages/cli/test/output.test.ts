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
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      calls.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs valid JSON envelope with meta block", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("test", { foo: "bar" }, false, reqCtx);
    const parsed = JSON.parse(calls[0]);
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
    const parsed = JSON.parse(calls[0]);
    expect(parsed.meta.gasCostMist).toBe(1420000);
    expect(parsed.meta.gasCostDisplay).toBe("0.001420 SUI");
  });

  it("outputs human-readable format", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("test", { key: "value" }, true, reqCtx);
    // New format uses grouped sections with symbols, not "test successful"
    expect(calls[0]).toContain("test");
    expect(calls[0]).toContain("value");
  });
});

describe("outputError", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      calls.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs structured error JSON with meta", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NO_WALLET", "No wallet configured", false, "Set SUI_PRIVATE_KEY", false, reqCtx);
    const parsed = JSON.parse(calls[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NO_WALLET");
    expect(parsed.error.suggestedAction).toBe("Set SUI_PRIVATE_KEY");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.network).toBe("testnet");
  });

  it("includes retryAfterMs when provided", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NETWORK_ERROR", "RPC unreachable", true, "Retry later", false, reqCtx, 30000);
    const parsed = JSON.parse(calls[0]);
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.retryAfterMs).toBe(30000);
  });

  it("works without reqCtx (fallback meta)", () => {
    outputError("pay", "NO_WALLET", "No wallet configured");
    const parsed = JSON.parse(calls[0]);
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.network).toBe("unknown");
  });
});

// ─── A2: Envelope contract assertions ───────────────────────────

describe("A2: Output envelope contract — success", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      calls.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envelope always has ok, command, version, data, meta at top level", () => {
    const reqCtx = createRequestContext("mainnet");
    outputSuccess("balance", { address: "0x1", balance: "100" }, false, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(env).toHaveProperty("ok", true);
    expect(env).toHaveProperty("command", "balance");
    expect(env).toHaveProperty("version", VERSION);
    expect(env).toHaveProperty("data");
    expect(env).toHaveProperty("meta");
  });

  it("meta always has network, durationMs, cliVersion, requestId", () => {
    const reqCtx = createRequestContext("mainnet");
    outputSuccess("receipt", { receiptId: "0xabc" }, false, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(typeof env.meta.network).toBe("string");
    expect(env.meta.network).toBe("mainnet");
    expect(typeof env.meta.durationMs).toBe("number");
    expect(env.meta.cliVersion).toBe(VERSION);
    expect(env.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("meta.gasCostMist and meta.gasCostDisplay absent when no gas provided", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("balance", { balance: "0" }, false, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(env.meta.gasCostMist).toBeUndefined();
    expect(env.meta.gasCostDisplay).toBeUndefined();
  });

  it("meta.gasCostMist and meta.gasCostDisplay present when gas provided", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay", { txDigest: "abc" }, false, reqCtx, { mist: 500000, display: "0.000500 SUI" });
    const env = JSON.parse(calls[0]);
    expect(env.meta.gasCostMist).toBe(500000);
    expect(env.meta.gasCostDisplay).toBe("0.000500 SUI");
  });

  it("command field in envelope matches the command name string exactly", () => {
    const commands = ["pay", "pay-402", "balance", "receipt", "doctor",
      "wallet generate", "mandate create", "mandate check", "mandate list",
      "prepaid deposit", "prepaid status", "prepaid list", "schema"];
    const reqCtx = createRequestContext("testnet");

    for (const cmd of commands) {
      calls.length = 0;
      outputSuccess(cmd, { ok: true }, false, reqCtx);
      const env = JSON.parse(calls[0]);
      expect(env.command).toBe(cmd);
    }
  });
});

describe("A2: Output envelope contract — error", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      calls.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("error envelope has ok:false, command, version, error, meta at top level", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NO_WALLET", "No wallet configured", false, undefined, false, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(env.ok).toBe(false);
    expect(env.command).toBe("pay");
    expect(env.version).toBe(VERSION);
    expect(env).toHaveProperty("error");
    expect(env).toHaveProperty("meta");
  });

  it("error.code, error.message, error.retryable always present", () => {
    outputError("balance", "NETWORK_ERROR", "RPC unreachable", true);
    const env = JSON.parse(calls[0]);
    expect(typeof env.error.code).toBe("string");
    expect(typeof env.error.message).toBe("string");
    expect(typeof env.error.retryable).toBe("boolean");
  });

  it("error envelope meta has network, durationMs, cliVersion, requestId", () => {
    const reqCtx = createRequestContext("devnet");
    outputError("doctor", "TIMEOUT", "RPC timed out", true, undefined, false, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(env.meta.network).toBe("devnet");
    expect(typeof env.meta.durationMs).toBe("number");
    expect(env.meta.cliVersion).toBe(VERSION);
    expect(env.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requiresHumanAction only present when true (not emitted as false)", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "MANDATE_EXPIRED", "expired", false, undefined, true, reqCtx);
    const env = JSON.parse(calls[0]);
    expect(env.error.requiresHumanAction).toBe(true);

    calls.length = 0;
    outputError("pay", "MISSING_ARGS", "missing", false, undefined, false, reqCtx);
    const env2 = JSON.parse(calls[0]);
    // false → should not be present in JSON (omitted via spread)
    expect(env2.error.requiresHumanAction).toBeUndefined();
  });
});

// ─── A5: Human output — no [object Object], structured display ──

describe("A5: Human output — structured command formatting", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pay success — shows transaction, amount, recipient", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay", {
      txDigest: "7P8wDGJ7aRd6",
      recipient: "0x0000000000000000000000000000000000000000000000000000000000000001",
      amount: "1500000000",
      amountFormatted: "1.5 SUI",
      coin: "0x2::sui::SUI",
      receiptId: "0xreceipt123",
      gasCostSui: "0.001234",
      network: "testnet",
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("Payment Confirmed");
    expect(output).toContain("7P8wDGJ7aRd6");
    expect(output).toContain("1.5 SUI");
  });

  it("pay dry-run — shows balance and shortfall info", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay", {
      dryRun: true,
      recipient: "0x0000000000000000000000000000000000000000000000000000000000000001",
      amount: "1500000000",
      amountFormatted: "1.5 SUI",
      affordable: false,
      currentBalance: {
        payment: "1.0 SUI",
        gas: "0.5 SUI",
      },
      shortfall: {
        payment: "0.5 SUI",
      },
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("Dry Run");
    expect(output).toContain("1.0 SUI");
    expect(output).toContain("0.5 SUI");
  });

  it("pay-402 success — shows URL, payment details, transaction", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay-402", {
      url: "https://api.example.com",
      httpStatus: 200,
      paymentRequired: true,
      protocol: "s402",
      requirements: { amount: "1000000", asset: "0x2::sui::SUI", scheme: "sui-direct" },
      payment: {
        txDigest: "abc123",
        receiptId: "0xreceipt",
        amountPaid: "1000000",
        coin: "0x2::sui::SUI",
      },
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("402 Payment Complete");
    expect(output).toContain("abc123");
    expect(output).toContain("https://api.example.com");
  });

  it("mandate list — shows items with object IDs and fields", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("mandate list", {
      address: "0x0000000000000000000000000000000000000000000000000000000000000001",
      count: 2,
      mandates: [
        {
          objectId: "0xmandate1",
          type: "0xTEST::mandate::Mandate",
          fields: { delegate: "0xagent", max_per_tx: "1000000000" },
        },
        {
          objectId: "0xmandate2",
          type: "0xTEST::mandate::Mandate",
          fields: { delegate: "0xagent2", max_per_tx: "2000000000" },
        },
      ],
      network: "testnet",
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("2 Mandates");
    expect(output).toContain("0xmandate1");
    expect(output).toContain("0xmandate2");
  });

  it("prepaid list — shows items with object IDs", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("prepaid list", {
      address: "0x0000000000000000000000000000000000000000000000000000000000000001",
      count: 1,
      balances: [
        {
          objectId: "0xbalance1",
          type: "0xTEST::prepaid::PrepaidBalance",
          fields: { amount: "5000000000", provider: "0xprovider" },
        },
      ],
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("Prepaid Balances");
    expect(output).toContain("0xbalance1");
  });

  it("empty list shows 'No ... Found' message", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("mandate list", {
      address: "0x0000000000000000000000000000000000000000000000000000000000000001",
      count: 0,
      mandates: [],
      message: "No mandates found.",
    }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("No Mandates Found");
  });

  it("generic fallback renders key-value pairs for unknown commands", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("test", { tags: ["alpha", "beta", "gamma"] }, true, reqCtx);
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("test");
    // Generic fallback shows array count
    expect(output).toContain("3 items");
  });

  it("null and undefined values are skipped in pay output", () => {
    const reqCtx = createRequestContext("testnet");
    outputSuccess("pay", {
      txDigest: "abc",
      mandateId: undefined,
      shortfall: null,
    } as Record<string, unknown>, true, reqCtx);
    expect(output).toContain("abc");
    expect(output).not.toContain("mandateId");
    expect(output).not.toContain("shortfall");
  });

  it("outputError respects human flag", () => {
    const reqCtx = createRequestContext("testnet");
    outputError("pay", "NO_WALLET", "No wallet configured", false, "Set SUI_PRIVATE_KEY", false, reqCtx, undefined, true);
    expect(output).toContain("NO_WALLET");
    expect(output).toContain("No wallet configured");
    expect(output).toContain("Set SUI_PRIVATE_KEY");
    // Should NOT be valid JSON
    expect(() => JSON.parse(output)).toThrow();
  });
});
