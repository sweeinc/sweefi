/**
 * Gas Sponsor Tracker Tests
 *
 * Tests the InMemoryGasSponsorTracker token bucket implementation:
 *   - Basic rate limiting (maxPerHour enforcement)
 *   - Token refill over time
 *   - Per-key isolation
 *   - Disabled mode (maxPerHour=0)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryGasSponsorTracker } from "../src/metering/gas-sponsor-tracker";

describe("InMemoryGasSponsorTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows sponsorship up to maxPerHour", async () => {
    const tracker = new InMemoryGasSponsorTracker(3);

    // First 3 should succeed
    expect(await tracker.canSponsor("key-a")).toBe(true);
    await tracker.recordSponsored("key-a");
    expect(await tracker.canSponsor("key-a")).toBe(true);
    await tracker.recordSponsored("key-a");
    expect(await tracker.canSponsor("key-a")).toBe(true);
    await tracker.recordSponsored("key-a");

    // 4th should be rejected
    expect(await tracker.canSponsor("key-a")).toBe(false);
  });

  it("isolates rate limits per API key", async () => {
    const tracker = new InMemoryGasSponsorTracker(2);

    // Exhaust key-a
    await tracker.recordSponsored("key-a");
    await tracker.recordSponsored("key-a");
    expect(await tracker.canSponsor("key-a")).toBe(false);

    // key-b should still have full budget
    expect(await tracker.canSponsor("key-b")).toBe(true);
  });

  it("refills tokens over time", async () => {
    vi.useFakeTimers();
    const tracker = new InMemoryGasSponsorTracker(100); // 100/hour

    // Use all tokens
    for (let i = 0; i < 100; i++) {
      await tracker.recordSponsored("key-a");
    }
    expect(await tracker.canSponsor("key-a")).toBe(false);

    // Advance 36 seconds = 1 token refilled (100/3600 ≈ 0.0278/sec × 36 ≈ 1.0)
    vi.advanceTimersByTime(36_000);
    expect(await tracker.canSponsor("key-a")).toBe(true);
  });

  it("does not exceed capacity when refilling", async () => {
    vi.useFakeTimers();
    const tracker = new InMemoryGasSponsorTracker(5);

    // Wait a long time without using any tokens
    vi.advanceTimersByTime(3_600_000); // 1 full hour

    // Should still only allow 5 (capacity), not more
    for (let i = 0; i < 5; i++) {
      expect(await tracker.canSponsor("key-a")).toBe(true);
      await tracker.recordSponsored("key-a");
    }
    expect(await tracker.canSponsor("key-a")).toBe(false);
  });

  it("returns false for all operations when maxPerHour=0 (disabled)", async () => {
    const tracker = new InMemoryGasSponsorTracker(0);

    expect(await tracker.canSponsor("key-a")).toBe(false);
    // recordSponsored is a no-op when disabled — should not throw
    await tracker.recordSponsored("key-a");
  });

  it("handles concurrent keys without interference", async () => {
    const tracker = new InMemoryGasSponsorTracker(10);

    // Interleave operations across keys
    await tracker.recordSponsored("key-a");
    await tracker.recordSponsored("key-b");
    await tracker.recordSponsored("key-a");
    await tracker.recordSponsored("key-c");

    // key-a used 2, key-b used 1, key-c used 1
    // All should still have remaining tokens
    expect(await tracker.canSponsor("key-a")).toBe(true);
    expect(await tracker.canSponsor("key-b")).toBe(true);
    expect(await tracker.canSponsor("key-c")).toBe(true);
  });
});
