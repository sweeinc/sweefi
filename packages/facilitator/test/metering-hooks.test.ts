import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { UsageTracker } from "../src/metering/usage-tracker";
import {
  registerMeteringHooks,
  meteringContext,
  requestApiKey,
} from "../src/metering/hooks";

/**
 * Creates a mock facilitator that captures the onAfterSettle callback
 * so tests can invoke it manually with controlled context.
 */
function createHookCapture() {
  let captured: ((ctx: any) => Promise<void>) | null = null;
  const mockFacilitator = {
    onAfterSettle: vi.fn((hook: (ctx: any) => Promise<void>) => {
      captured = hook;
      return mockFacilitator; // chainable
    }),
  };
  return {
    facilitator: mockFacilitator as any,
    fire: (ctx: any) => {
      if (!captured) throw new Error("No hook registered");
      return captured(ctx);
    },
  };
}

/** Build a realistic FacilitatorSettleResultContext for testing. */
function makeSettleContext(overrides?: {
  amount?: string;
  network?: string;
  transaction?: string;
  payer?: string;
}) {
  return {
    paymentPayload: {
      x402Version: 2,
      resource: { url: "https://api.example.com/data" },
      accepted: {},
      payload: {},
    },
    requirements: {
      scheme: "exact",
      network: overrides?.network ?? "sui:testnet",
      asset: "0x2::sui::SUI",
      amount: overrides?.amount ?? "1000000",
      payTo: "0x" + "b".repeat(64),
      maxTimeoutSeconds: 300,
      extra: {},
    },
    result: {
      success: true,
      payer: overrides?.payer ?? "0x" + "a".repeat(64),
      transaction: overrides?.transaction ?? "ABCDtxdigest123",
      network: overrides?.network ?? "sui:testnet",
    },
  };
}

describe("registerMeteringHooks", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it("registers an onAfterSettle hook on the facilitator", () => {
    const { facilitator } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 50);
    expect(facilitator.onAfterSettle).toHaveBeenCalledOnce();
  });

  it("records settlement when API key is in AsyncLocalStorage", async () => {
    const { facilitator, fire } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 50);

    await requestApiKey.run("test-key-123", () => fire(makeSettleContext()));

    expect(tracker.getTotalSettled("test-key-123")).toBe(1000000n);
  });

  it("skips recording when no API key in context", async () => {
    const { facilitator, fire } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 50);

    // Fire hook outside AsyncLocalStorage — no API key available
    await fire(makeSettleContext());

    expect(tracker.getAllRecords().size).toBe(0);
  });

  it("records correct settlement details (amount, network, txDigest)", async () => {
    const { facilitator, fire } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 50);

    const ctx = makeSettleContext({
      amount: "5000000",
      network: "sui:mainnet",
      transaction: "mainnet-tx-abc",
    });

    await requestApiKey.run("prod-key", () => fire(ctx));

    const records = tracker.getAllRecords().get("prod-key");
    expect(records).toHaveLength(1);
    expect(records![0]).toMatchObject({
      amount: "5000000",
      network: "sui:mainnet",
      txDigest: "mainnet-tx-abc",
    });
  });

  it("logs structured settlement event with calculated fee", async () => {
    const { facilitator, fire } = createHookCapture();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    registerMeteringHooks(facilitator, tracker, 50);

    await requestApiKey.run("log-key-abc", () =>
      fire(makeSettleContext({ amount: "1000000" })),
    );

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged).toMatchObject({
      event: "settlement_metered",
      amount: "1000000",
      fee: "5000", // 1,000,000 * 50 / 10,000 = 5,000
      feeBps: 50,
      network: "sui:testnet",
      txDigest: "ABCDtxdigest123",
    });
    consoleSpy.mockRestore();
  });

  it("handles multiple settlements per API key", async () => {
    const { facilitator, fire } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 100);

    await requestApiKey.run("multi-key", async () => {
      await fire(makeSettleContext({ amount: "1000000", transaction: "tx-1" }));
      await fire(makeSettleContext({ amount: "2000000", transaction: "tx-2" }));
    });

    expect(tracker.getTotalSettled("multi-key")).toBe(3000000n);
    expect(tracker.getAllRecords().get("multi-key")).toHaveLength(2);
  });

  it("isolates settlements across different API keys", async () => {
    const { facilitator, fire } = createHookCapture();
    registerMeteringHooks(facilitator, tracker, 50);

    await requestApiKey.run("key-a", () =>
      fire(makeSettleContext({ amount: "1000000" })),
    );
    await requestApiKey.run("key-b", () =>
      fire(makeSettleContext({ amount: "3000000" })),
    );

    expect(tracker.getTotalSettled("key-a")).toBe(1000000n);
    expect(tracker.getTotalSettled("key-b")).toBe(3000000n);
  });

  it("does not crash if tracker.record throws", async () => {
    const { facilitator, fire } = createHookCapture();
    const brokenTracker = {
      record: () => { throw new Error("storage full"); },
      getTotalSettled: () => 0n,
      getAllRecords: () => new Map(),
    } as unknown as UsageTracker;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registerMeteringHooks(facilitator, brokenTracker, 50);

    // Should not throw — hook catches and logs the error
    await requestApiKey.run("crash-key", () => fire(makeSettleContext()));

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
