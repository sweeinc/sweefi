import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { UsageTracker } from "../src/metering/usage-tracker";
import {
  recordSettlement,
  meteringContext,
  requestApiKey,
} from "../src/metering/hooks";
import type { s402SettleResponse, s402PaymentRequirements } from "s402";

/** Build realistic s402 requirements for testing. */
function makeRequirements(overrides?: Partial<s402PaymentRequirements>): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["exact"],
    network: overrides?.network ?? "sui:testnet",
    asset: "0x2::sui::SUI",
    amount: overrides?.amount ?? "1000000",
    payTo: "0x" + "b".repeat(64),
    ...overrides,
  };
}

/** Build a realistic s402SettleResponse for testing. */
function makeSettleResult(overrides?: Partial<s402SettleResponse>): s402SettleResponse {
  return {
    success: true,
    txDigest: overrides?.txDigest ?? "ABCDtxdigest123",
    ...overrides,
  };
}

describe("recordSettlement", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it("records settlement in usage tracker", () => {
    recordSettlement(tracker, "test-key-123", makeRequirements(), makeSettleResult(), 5_000);
    expect(tracker.getTotalSettled("test-key-123")).toBe(1000000n);
  });

  it("records correct settlement details (amount, network, txDigest)", () => {
    recordSettlement(
      tracker,
      "prod-key",
      makeRequirements({ amount: "5000000", network: "sui:mainnet" }),
      makeSettleResult({ txDigest: "mainnet-tx-abc" }),
      5_000,
    );

    const records = tracker.getAllRecords().get("prod-key");
    expect(records).toHaveLength(1);
    expect(records![0]).toMatchObject({
      amount: "5000000",
      network: "sui:mainnet",
      txDigest: "mainnet-tx-abc",
    });
  });

  it("logs structured settlement event with calculated fee", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    recordSettlement(
      tracker,
      "log-key-abcdefgh",
      makeRequirements({ amount: "1000000" }),
      makeSettleResult(),
      5_000,
    );

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged).toMatchObject({
      event: "settlement_metered",
      amount: "1000000",
      fee: "5000", // 1,000,000 * 5,000 / 1,000,000 = 5,000
      feeMicroPercent: 5_000,
      network: "sui:testnet",
      txDigest: "ABCDtxdigest123",
    });
    consoleSpy.mockRestore();
  });

  it("handles multiple settlements per API key", () => {
    recordSettlement(tracker, "multi-key", makeRequirements({ amount: "1000000" }), makeSettleResult({ txDigest: "tx-1" }), 10_000);
    recordSettlement(tracker, "multi-key", makeRequirements({ amount: "2000000" }), makeSettleResult({ txDigest: "tx-2" }), 10_000);

    expect(tracker.getTotalSettled("multi-key")).toBe(3000000n);
    expect(tracker.getAllRecords().get("multi-key")).toHaveLength(2);
  });

  it("isolates settlements across different API keys", () => {
    recordSettlement(tracker, "key-a", makeRequirements({ amount: "1000000" }), makeSettleResult(), 5_000);
    recordSettlement(tracker, "key-b", makeRequirements({ amount: "3000000" }), makeSettleResult(), 5_000);

    expect(tracker.getTotalSettled("key-a")).toBe(1000000n);
    expect(tracker.getTotalSettled("key-b")).toBe(3000000n);
  });

  it("does not crash if tracker.record throws", () => {
    const brokenTracker = {
      record: () => { throw new Error("storage full"); },
      getTotalSettled: () => 0n,
      getAllRecords: () => new Map(),
    } as unknown as UsageTracker;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw — catches and logs the error
    recordSettlement(brokenTracker, "crash-key", makeRequirements(), makeSettleResult(), 5_000);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("[metering]");
    errorSpy.mockRestore();
  });
});

describe("meteringContext middleware", () => {
  it("propagates apiKey from Hono context into AsyncLocalStorage", async () => {
    const app = new Hono<{ Variables: { apiKey: string } }>();
    let capturedKey: string | undefined;

    // Simulate auth middleware setting apiKey
    app.use("*", async (c, next) => {
      c.set("apiKey", "middleware-test-key");
      await next();
    });
    app.use("*", meteringContext());
    app.get("/test", (c) => {
      capturedKey = requestApiKey.getStore();
      return c.json({ ok: true });
    });

    await app.request("/test");
    expect(capturedKey).toBe("middleware-test-key");
  });

  it("passes through without error when no apiKey is set", async () => {
    const app = new Hono();
    let capturedKey: string | undefined = "should-be-undefined";

    app.use("*", meteringContext());
    app.get("/test", (c) => {
      capturedKey = requestApiKey.getStore();
      return c.json({ ok: true });
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(capturedKey).toBeUndefined();
  });
});
