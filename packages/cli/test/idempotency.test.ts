import { describe, it, expect, vi } from "vitest";
import { validateIdempotencyKey, buildIdempotencyMemo, checkIdempotencyKey } from "../src/idempotency";
import { CliError } from "../src/context";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

// ─── Helpers for RPC-level idempotency tests ───────────────────────────────────

const TEST_PACKAGE = "0xTEST";
const SENDER = "0x" + "a".repeat(64);
const RECIPIENT = "0x" + "b".repeat(64);

function makeReceiptPage(opts: {
  key?: string;
  recipient?: string;
  amount?: string;
  objectId?: string;
  previousTransaction?: string;
  hasNextPage?: boolean;
  nextCursor?: string | null;
  rawMemo?: string; // override memo directly
}) {
  const key = opts.key;
  const memo = opts.rawMemo
    ? opts.rawMemo
    : key
      ? Buffer.from(`swee:idempotency:${key}`).toString("base64")
      : undefined;

  return {
    data: [
      {
        data: {
          objectId: opts.objectId ?? "0xRECEIPT",
          previousTransaction: opts.previousTransaction ?? "0xTX_DIGEST",
          content: {
            dataType: "moveObject",
            fields: {
              recipient: opts.recipient ?? RECIPIENT,
              amount: opts.amount ?? "1000000000",
              ...(memo !== undefined && { memo }),
            },
          },
        },
      },
    ],
    hasNextPage: opts.hasNextPage ?? false,
    nextCursor: opts.nextCursor ?? null,
  };
}

function makeEmptyPage(hasNextPage = false, nextCursor: string | null = null) {
  return { data: [], hasNextPage, nextCursor };
}

function mockClient(pages: Array<ReturnType<typeof makeReceiptPage> | ReturnType<typeof makeEmptyPage>>) {
  let call = 0;
  return {
    getOwnedObjects: vi.fn().mockImplementation(() => {
      const page = pages[call] ?? makeEmptyPage();
      call++;
      return Promise.resolve(page);
    }),
  } as unknown as SuiJsonRpcClient;
}

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

// ─── B5: RPC-level idempotency tests ──────────────────────────────────────────

describe("checkIdempotencyKey (RPC-level)", () => {
  it("returns null when no pages have a matching receipt", async () => {
    const client = mockClient([makeEmptyPage()]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "no-match", RECIPIENT, 1000n);
    expect(result).toBeNull();
  });

  it("returns receipt when memo matches on first page", async () => {
    const client = mockClient([makeReceiptPage({ key: "my-key", objectId: "0xABC", previousTransaction: "0xTXDIGEST" })]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "my-key", RECIPIENT, 1_000_000_000n);
    expect(result).not.toBeNull();
    expect(result!.receiptId).toBe("0xABC");
    expect(result!.txDigest).toBe("0xTXDIGEST");
  });

  it("finds match on page 2 (pagination)", async () => {
    // Page 1: different key — no match. Page 2: matching key.
    const client = mockClient([
      makeReceiptPage({ key: "other-key", hasNextPage: true, nextCursor: "cursor1" }),
      makeReceiptPage({ key: "my-key", objectId: "0xPAGE2" }),
    ]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "my-key", RECIPIENT, 1_000_000_000n);
    expect(result).not.toBeNull();
    expect(result!.receiptId).toBe("0xPAGE2");
  });

  it("returns null after MAX_PAGES with no match (does not loop forever)", async () => {
    // 20 pages all with wrong key + hasNextPage: true → should stop and return null
    const pages = Array.from({ length: 21 }, (_, i) =>
      makeReceiptPage({ key: "wrong-key", hasNextPage: true, nextCursor: `cursor${i}` }),
    );
    const client = mockClient(pages);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "never-found", RECIPIENT, 1_000_000_000n);
    expect(result).toBeNull();
    // Should have stopped at MAX_PAGES (20 calls)
    expect((client.getOwnedObjects as ReturnType<typeof vi.fn>).mock.calls.length).toBe(20);
  });

  it("throws IDEMPOTENCY_CONFLICT when same key used with different recipient", async () => {
    const client = mockClient([makeReceiptPage({ key: "dup-key", recipient: "0x" + "c".repeat(64) })]);
    await expect(
      checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "dup-key", RECIPIENT, 1_000_000_000n),
    ).rejects.toThrow(CliError);
    try {
      const client2 = mockClient([makeReceiptPage({ key: "dup-key", recipient: "0x" + "c".repeat(64) })]);
      await checkIdempotencyKey(client2, SENDER, TEST_PACKAGE, "dup-key", RECIPIENT, 1_000_000_000n);
    } catch (e) {
      expect((e as CliError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("throws IDEMPOTENCY_CONFLICT when same key used with different amount", async () => {
    const client = mockClient([makeReceiptPage({ key: "dup-key", recipient: RECIPIENT, amount: "999" })]);
    try {
      await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "dup-key", RECIPIENT, 1_000_000_000n);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("returns receipt without conflict check when skipConflictCheck=true", async () => {
    // Different recipient + different amount — but skipConflictCheck lets it through
    const client = mockClient([makeReceiptPage({ key: "skip-key", recipient: "0x" + "f".repeat(64), amount: "1" })]);
    const result = await checkIdempotencyKey(
      client, SENDER, TEST_PACKAGE, "skip-key",
      RECIPIENT, // different from what's on chain
      9999n,     // different from what's on chain
      true,      // skipConflictCheck
    );
    expect(result).not.toBeNull();
  });

  it("returns null gracefully for empty data page", async () => {
    const client = mockClient([makeEmptyPage(false, null)]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "any-key", RECIPIENT, 1n);
    expect(result).toBeNull();
  });

  it("falls through gracefully when memo is non-base64 (malformed)", async () => {
    // Non-base64 memo — decodeMemo falls back to using the raw string
    // If raw string doesn't match the needle, no crash, returns null
    const client = mockClient([
      makeReceiptPage({ rawMemo: "not!!valid!!base64!!###", key: undefined }),
    ]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "my-key", RECIPIENT, 1n);
    expect(result).toBeNull();
  });

  it("populates txDigest from previousTransaction field", async () => {
    const client = mockClient([
      makeReceiptPage({ key: "digest-test", previousTransaction: "0xTHETXDIGEST" }),
    ]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "digest-test", RECIPIENT, 1_000_000_000n);
    expect(result!.txDigest).toBe("0xTHETXDIGEST");
  });

  it("exact match: key 'abc' does not match receipt with key 'abc-123'", async () => {
    // Regression: substring matching would cause 'abc' to match 'abc-123'
    const client = mockClient([makeReceiptPage({ key: "abc-123" })]);
    const result = await checkIdempotencyKey(client, SENDER, TEST_PACKAGE, "abc", RECIPIENT, 1_000_000_000n);
    expect(result).toBeNull();
  });
});
