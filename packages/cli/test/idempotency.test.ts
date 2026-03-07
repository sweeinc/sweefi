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

  it("memo always contains the idempotency needle", () => {
    // This is the invariant that makes includes() matching work:
    // regardless of user memo, the needle "swee:idempotency:<key>" is always present
    const withMemo = buildIdempotencyMemo("abc", "user text with | pipe chars");
    const withoutMemo = buildIdempotencyMemo("abc");
    expect(withMemo).toContain("swee:idempotency:abc");
    expect(withoutMemo).toContain("swee:idempotency:abc");
  });

  it("user memo with pipe characters doesn't break the needle", () => {
    const memo = buildIdempotencyMemo("key123", "note | with | pipes");
    expect(memo).toBe("note | with | pipes | swee:idempotency:key123");
    expect(memo).toContain("swee:idempotency:key123");
  });
});
