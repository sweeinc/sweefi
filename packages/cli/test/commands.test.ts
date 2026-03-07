/**
 * Integration tests for command handlers.
 *
 * These tests exercise the actual command functions with mocked SuiClient,
 * verifying the full path: args → validation → RPC → output envelope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CliContext } from "../src/context";
import { CliError } from "../src/context";
import { createRequestContext } from "../src/output";

// ─── Test helpers ───────────────────────────────────────────────

function createMockContext(overrides?: Partial<CliContext>): CliContext {
  const mockClient = {
    getBalance: vi.fn(),
    getObject: vi.fn(),
    getOwnedObjects: vi.fn(),
    getRpcApiVersion: vi.fn(),
    devInspectTransactionBlock: vi.fn(),
    signAndExecuteTransaction: vi.fn(),
  };

  return {
    suiClient: mockClient as unknown as CliContext["suiClient"],
    signer: null,
    config: { packageId: "0xTEST_PACKAGE", protocolStateId: "0xTEST_STATE" },
    network: "testnet",
    verbose: false,
    timeoutMs: 30_000,
    ...overrides,
  };
}

function captureStdout() {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    calls.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  return {
    spy,
    /** Parse the first JSON envelope written to stdout. */
    getEnvelope: () => JSON.parse(calls[0]),
    getRaw: () => calls.join(""),
    restore: () => spy.mockRestore(),
  };
}

const VALID_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";

// ─── balance ────────────────────────────────────────────────────

describe("balance command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns balance for explicit address", async () => {
    const { balance } = await import("../src/commands/balance");
    const ctx = createMockContext();
    (ctx.suiClient.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalBalance: "5000000000",
      coinObjectCount: 3,
    });

    const reqCtx = createRequestContext("testnet");
    await balance(ctx, [VALID_ADDRESS], { coin: "SUI" }, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("balance");
    expect(env.data.address).toBe(VALID_ADDRESS);
    expect(env.data.balance).toBe("5000000000");
    expect(env.data.balanceFormatted).toContain("5.0");
    expect(env.data.coinObjects).toBe(3);
    expect(env.meta.network).toBe("testnet");
  });

  it("throws on missing address without wallet", async () => {
    const { balance } = await import("../src/commands/balance");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    await expect(balance(ctx, [], {}, reqCtx)).rejects.toThrow(CliError);
  });

  it("throws on invalid address format", async () => {
    const { balance } = await import("../src/commands/balance");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    await expect(balance(ctx, ["not-hex"], {}, reqCtx)).rejects.toThrow(CliError);
  });
});

// ─── receipt ────────────────────────────────────────────────────

describe("receipt command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns receipt data for valid object ID", async () => {
    const { receipt } = await import("../src/commands/receipt");
    const ctx = createMockContext();
    const objectId = "0xabc123def456";
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        objectId,
        content: {
          dataType: "moveObject",
          type: "0xTEST::payment::PaymentReceipt",
          fields: { sender: VALID_ADDRESS, recipient: VALID_ADDRESS, amount: "1000000000" },
        },
        type: "0xTEST::payment::PaymentReceipt",
        owner: { AddressOwner: VALID_ADDRESS },
      },
    });

    const reqCtx = createRequestContext("testnet");
    await receipt(ctx, [objectId], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("receipt");
    expect(env.data.receiptId).toBe(objectId);
    expect(env.data.fields.amount).toBe("1000000000");
  });

  it("throws on missing object ID argument", async () => {
    const { receipt } = await import("../src/commands/receipt");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    await expect(receipt(ctx, [], {}, reqCtx)).rejects.toThrow(CliError);
  });

  it("throws when object not found", async () => {
    const { receipt } = await import("../src/commands/receipt");
    const ctx = createMockContext();
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { code: "notExists" },
    });

    const reqCtx = createRequestContext("testnet");
    await expect(receipt(ctx, ["0xdead"], {}, reqCtx)).rejects.toThrow(CliError);
  });
});

// ─── wallet generate ────────────────────────────────────────────

describe("wallet generate command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("generates a valid keypair", async () => {
    const { walletGenerate } = await import("../src/commands/wallet");
    const reqCtx = createRequestContext("testnet");

    walletGenerate({}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("wallet generate");
    expect(env.data.address).toMatch(/^0x[a-f0-9]{64}$/);
    expect(env.data.privateKey).toBeDefined();
    expect(env.data.setup).toContain("export SUI_PRIVATE_KEY=");
  });

  it("generates different keypairs each time", async () => {
    const { walletGenerate } = await import("../src/commands/wallet");
    const reqCtx1 = createRequestContext("testnet");
    const reqCtx2 = createRequestContext("testnet");

    walletGenerate({}, reqCtx1);
    const env1 = stdout.getEnvelope();
    stdout.restore();
    stdout = captureStdout();

    walletGenerate({}, reqCtx2);
    const env2 = stdout.getEnvelope();

    expect(env1.data.address).not.toBe(env2.data.address);
  });
});

// ─── doctor ─────────────────────────────────────────────────────

describe("doctor command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("reports healthy when RPC is reachable", async () => {
    const { doctor } = await import("../src/commands/doctor");
    const ctx = createMockContext();
    (ctx.suiClient.getRpcApiVersion as ReturnType<typeof vi.fn>).mockResolvedValue("1.42.0");

    const reqCtx = createRequestContext("testnet");
    await doctor(ctx, {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("doctor");
    // Without signer, wallet check will fail
    expect(env.data.healthy).toBe(false);
    const walletCheck = env.data.checks.find((c: { name: string }) => c.name === "wallet");
    expect(walletCheck.status).toBe("FAIL");
    const rpcCheck = env.data.checks.find((c: { name: string }) => c.name === "RPC connectivity");
    expect(rpcCheck.status).toBe("OK");
  });

  it("reports RPC failure on error", async () => {
    const { doctor } = await import("../src/commands/doctor");
    const ctx = createMockContext();
    (ctx.suiClient.getRpcApiVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));

    const reqCtx = createRequestContext("testnet");
    await doctor(ctx, {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.data.healthy).toBe(false);
    const rpcCheck = env.data.checks.find((c: { name: string }) => c.name === "RPC connectivity");
    expect(rpcCheck.status).toBe("FAIL");
    expect(rpcCheck.detail).toContain("ECONNREFUSED");
  });

  it("human mode outputs plain text", async () => {
    const { doctor } = await import("../src/commands/doctor");
    const ctx = createMockContext();
    (ctx.suiClient.getRpcApiVersion as ReturnType<typeof vi.fn>).mockResolvedValue("1.42.0");

    const reqCtx = createRequestContext("testnet");
    await doctor(ctx, { human: true }, reqCtx);

    const raw = stdout.getRaw();
    expect(raw).toContain("sweefi doctor");
    expect(raw).toContain("version");
    expect(raw).toContain("network");
  });
});

// ─── mandate check ──────────────────────────────────────────────

describe("mandate check command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns mandate fields for valid object", async () => {
    const { mandateCheck } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    const mandateId = "0xaaa111bbb222";
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        objectId: mandateId,
        content: {
          dataType: "moveObject",
          fields: {
            delegate: VALID_ADDRESS,
            max_per_tx: "1000000000",
            max_total: "50000000000",
            total_spent: "0",
            expires_at_ms: String(Date.now() + 86_400_000),
          },
        },
        owner: { AddressOwner: VALID_ADDRESS },
      },
    });

    const reqCtx = createRequestContext("testnet");
    await mandateCheck(ctx, [mandateId], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("mandate check");
    expect(env.data.mandateId).toBe(mandateId);
    expect(env.data.expired).toBe(false);
    expect(env.data.delegate).toBe(VALID_ADDRESS);
  });

  it("detects expired mandates", async () => {
    const { mandateCheck } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        objectId: "0xdead0001",
        content: {
          dataType: "moveObject",
          fields: {
            expires_at_ms: String(Date.now() - 1000),
          },
        },
      },
    });

    const reqCtx = createRequestContext("testnet");
    await mandateCheck(ctx, ["0xdead0001"], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.data.expired).toBe(true);
  });

  it("throws when mandate not found", async () => {
    const { mandateCheck } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { code: "notExists" },
    });

    const reqCtx = createRequestContext("testnet");
    await expect(mandateCheck(ctx, ["0xdead"], {}, reqCtx)).rejects.toThrow(CliError);
  });
});

// ─── prepaid status ─────────────────────────────────────────────

describe("prepaid status command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns prepaid balance fields", async () => {
    const { prepaidStatus } = await import("../src/commands/prepaid");
    const ctx = createMockContext();
    const balanceId = "0xba1a4ce456";
    (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        objectId: balanceId,
        content: {
          dataType: "moveObject",
          fields: {
            provider: VALID_ADDRESS,
            amount: "10000000000",
            rate_per_call: "10000000",
            calls_made: "5",
          },
        },
      },
    });

    const reqCtx = createRequestContext("testnet");
    await prepaidStatus(ctx, [balanceId], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("prepaid status");
    expect(env.data.balanceId).toBe(balanceId);
    expect(env.data.provider).toBe(VALID_ADDRESS);
  });
});

// ─── mandate list ───────────────────────────────────────────────

describe("mandate list command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns empty list with helpful message", async () => {
    const { mandateList } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    (ctx.suiClient.getOwnedObjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    });

    const reqCtx = createRequestContext("testnet");
    await mandateList(ctx, [VALID_ADDRESS], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(0);
    expect(env.data.message).toContain("No mandates found");
  });
});

// ─── prepaid list ───────────────────────────────────────────────

describe("prepaid list command", () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => { stdout = captureStdout(); });
  afterEach(() => { stdout.restore(); });

  it("returns list with objects", async () => {
    const { prepaidList } = await import("../src/commands/prepaid");
    const ctx = createMockContext();
    (ctx.suiClient.getOwnedObjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          data: {
            objectId: "0xbal1",
            type: "0xTEST::prepaid::PrepaidBalance<0x2::sui::SUI>",
            content: {
              dataType: "moveObject",
              fields: { amount: "5000000000" },
            },
          },
        },
      ],
      hasNextPage: false,
      nextCursor: null,
    });

    const reqCtx = createRequestContext("testnet");
    await prepaidList(ctx, [VALID_ADDRESS], {}, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(1);
    expect(env.data.balances[0].objectId).toBe("0xbal1");
  });
});

// ─── pay (argument validation) ──────────────────────────────────

describe("pay command (validation paths)", () => {
  it("rejects missing arguments", async () => {
    const { pay } = await import("../src/commands/pay");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    await expect(pay(ctx, [], {}, reqCtx)).rejects.toThrow(CliError);
  });

  it("requires idempotency key in JSON mode", async () => {
    const { pay } = await import("../src/commands/pay");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay(ctx, [VALID_ADDRESS, "1.5"], {}, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("does not require idempotency key in human mode", async () => {
    const { pay } = await import("../src/commands/pay");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    // Should fail on requireSigner, not idempotency
    try {
      await pay(ctx, [VALID_ADDRESS, "1.5"], { human: true }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("NO_WALLET");
    }
  });

  it("does not require idempotency key in dry-run mode", async () => {
    const { pay } = await import("../src/commands/pay");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    // Should fail on requireSigner, not idempotency
    try {
      await pay(ctx, [VALID_ADDRESS, "1.5"], { dryRun: true }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("NO_WALLET");
    }
  });
});

// ─── context: withTimeout ───────────────────────────────────────

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const { withTimeout } = await import("../src/context");
    const ctx = createMockContext({ timeoutMs: 5000 });

    const result = await withTimeout(ctx, Promise.resolve("ok"), "test");
    expect(result).toBe("ok");
  });

  it("rejects when promise exceeds timeout", async () => {
    const { withTimeout } = await import("../src/context");
    const ctx = createMockContext({ timeoutMs: 10 });

    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(ctx, slow, "slow RPC")).rejects.toThrow(CliError);
  });

  it("includes label in timeout error message", async () => {
    const { withTimeout } = await import("../src/context");
    const ctx = createMockContext({ timeoutMs: 10 });

    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      await withTimeout(ctx, slow, "getBalance");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CliError).message).toContain("getBalance");
      expect((e as CliError).code).toBe("TIMEOUT");
      expect((e as CliError).retryable).toBe(true);
    }
  });
});

// ─── context: debug ─────────────────────────────────────────────

describe("debug", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("writes to stderr when verbose is true", async () => {
    const { debug } = await import("../src/context");
    const ctx = createMockContext({ verbose: true });

    debug(ctx, "hello", "world");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[sweefi");
    expect(output).toContain("hello world");
  });

  it("does nothing when verbose is false", async () => {
    const { debug } = await import("../src/context");
    const ctx = createMockContext({ verbose: false });

    debug(ctx, "should not appear");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("serializes objects as JSON", async () => {
    const { debug } = await import("../src/context");
    const ctx = createMockContext({ verbose: true });

    debug(ctx, "data:", { key: "value" });

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('"key":"value"');
  });
});

// ─── pay-402 (idempotency) ──────────────────────────────────────

describe("pay-402 command (idempotency)", () => {
  it("requires idempotency key in JSON mode", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay402(ctx, [], { url: "https://example.com" }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("does not require idempotency key in human mode", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    // Should fail on requireSigner, not idempotency
    try {
      await pay402(ctx, [], { url: "https://example.com", human: true }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("NO_WALLET");
    }
  });

  it("rejects missing URL", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay402(ctx, [], { idempotencyKey: "abc-123" }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });

  it("rejects invalid URL", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay402(ctx, [], { url: "not-a-url", idempotencyKey: "abc-123" }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("INVALID_URL");
    }
  });

  it("rejects non-http URL scheme", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay402(ctx, [], { url: "ftp://example.com/file", idempotencyKey: "abc-123" }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("INVALID_URL");
    }
  });

  it("does not require idempotency key in dry-run mode", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    // Should fail on requireSigner, not idempotency
    try {
      await pay402(ctx, [], { url: "https://example.com", dryRun: true }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("NO_WALLET");
    }
  });

  it("returns existing receipt when idempotency key matches", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const signer = new Ed25519Keypair();

    const ctx = createMockContext({
      signer,
    });

    // Mock getOwnedObjects to return an existing receipt with matching memo
    (ctx.suiClient.getOwnedObjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          data: {
            objectId: "0xexisting_receipt",
            content: {
              dataType: "moveObject",
              fields: {
                recipient: VALID_ADDRESS,
                amount: "1500000000",
                // "swee:idempotency:test-key-123" in base64
                memo: Buffer.from("swee:idempotency:test-key-123").toString("base64"),
              },
            },
          },
        },
      ],
      hasNextPage: false,
      nextCursor: null,
    });

    const stdout = captureStdout();
    const reqCtx = createRequestContext("testnet");

    await pay402(ctx, [], {
      url: "https://example.com/api",
      idempotencyKey: "test-key-123",
    }, reqCtx);

    const env = stdout.getEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe("pay-402");
    expect(env.data.idempotent).toBe(true);
    expect(env.data.payment.receiptId).toBe("0xexisting_receipt");
    expect(env.data.url).toBe("https://example.com/api");

    stdout.restore();
  });
});
