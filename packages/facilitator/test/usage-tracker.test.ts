import { describe, it, expect } from "vitest";
import { UsageTracker } from "../src/metering/usage-tracker";

describe("UsageTracker", () => {
  it("starts with zero total for unknown key", () => {
    const tracker = new UsageTracker();
    expect(tracker.getTotalSettled("unknown-key")).toBe(0n);
  });

  it("records and totals settlements", () => {
    const tracker = new UsageTracker();
    tracker.record("key-1", "1000000", "sui:testnet", "tx1");
    tracker.record("key-1", "500000", "sui:testnet", "tx2");

    expect(tracker.getTotalSettled("key-1")).toBe(1_500_000n);
  });

  it("tracks separately per API key", () => {
    const tracker = new UsageTracker();
    tracker.record("key-1", "1000000", "sui:testnet", "tx1");
    tracker.record("key-2", "500000", "sui:testnet", "tx2");

    expect(tracker.getTotalSettled("key-1")).toBe(1_000_000n);
    expect(tracker.getTotalSettled("key-2")).toBe(500_000n);
  });

  it("returns all records", () => {
    const tracker = new UsageTracker();
    tracker.record("key-1", "1000000", "sui:testnet", "tx1");
    tracker.record("key-2", "500000", "sui:mainnet", "tx2");

    const records = tracker.getAllRecords();
    expect(records.size).toBe(2);
    expect(records.get("key-1")).toHaveLength(1);
    expect(records.get("key-2")).toHaveLength(1);
    expect(records.get("key-1")![0].network).toBe("sui:testnet");
    expect(records.get("key-2")![0].network).toBe("sui:mainnet");
  });
});
