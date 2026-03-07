import { describe, it, expect } from "vitest";
import { validateIdempotencyKey, buildIdempotencyMemo } from "../src/idempotency";
import { CliError } from "../src/context";

describe("validateIdempotencyKey", () => {
  it("accepts valid UUIDs", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    expect(validateIdempotencyKey(key)).toBe(key);
  });

  it("accepts non-UUID strings", () => {
    expect(validateIdempotencyKey("my-key-123")).toBe("my-key-123");
  });

  it("trims whitespace", () => {
    expect(validateIdempotencyKey("  key  ")).toBe("key");
  });

  it("rejects empty strings", () => {
    expect(() => validateIdempotencyKey("")).toThrow(CliError);
    expect(() => validateIdempotencyKey("   ")).toThrow(CliError);
  });

  it("rejects overly long keys", () => {
    const long = "a".repeat(129);
    expect(() => validateIdempotencyKey(long)).toThrow(CliError);
  });

  it("accepts max length key", () => {
    const maxKey = "a".repeat(128);
    expect(validateIdempotencyKey(maxKey)).toBe(maxKey);
  });
});

describe("buildIdempotencyMemo", () => {
  it("builds memo with just idempotency key", () => {
    const memo = buildIdempotencyMemo("my-key");
    expect(memo).toBe("swee:idempotency:my-key");
  });

  it("appends user memo when provided", () => {
    const memo = buildIdempotencyMemo("my-key", "payment for API");
    expect(memo).toBe("payment for API | swee:idempotency:my-key");
  });

  it("handles empty user memo as absent", () => {
    const memo = buildIdempotencyMemo("my-key", undefined);
    expect(memo).toBe("swee:idempotency:my-key");
  });

  it("memo always contains the idempotency needle as an exact segment", () => {
    // The needle appears as a " | "-delimited segment for exact matching
    const withMemo = buildIdempotencyMemo("abc", "user text");
    const withoutMemo = buildIdempotencyMemo("abc");
    expect(withMemo).toContain("swee:idempotency:abc");
    expect(withoutMemo).toBe("swee:idempotency:abc");
  });

  it("user memo with pipe characters doesn't break the needle", () => {
    const memo = buildIdempotencyMemo("key123", "note | with | pipes");
    expect(memo).toBe("note | with | pipes | swee:idempotency:key123");
    expect(memo).toContain("swee:idempotency:key123");
  });

  it("short key is not a substring of longer key when split on delimiter", () => {
    // Regression: "abc" must not match memo containing "abc-123"
    const memoForLongKey = buildIdempotencyMemo("abc-123", "user text");
    const shortNeedle = "swee:idempotency:abc";
    // The short needle should NOT appear as an exact segment
    const segments = memoForLongKey.split(" | ");
    expect(segments.some((s) => s === shortNeedle)).toBe(false);
    // But the long needle should
    expect(segments.some((s) => s === "swee:idempotency:abc-123")).toBe(true);
  });
});
