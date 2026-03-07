/**
 * Idempotent payments via on-chain memo.
 *
 * When an agent provides --idempotency-key, the CLI:
 *   1. Queries Sui for existing PaymentReceipts from this sender
 *   2. Checks if any receipt memo contains "swee:idempotency:<key>"
 *   3. If found → return existing receipt (no new TX)
 *   4. If found but recipient/amount differ → IDEMPOTENCY_CONFLICT error
 *
 * This prevents double-spend when an agent crashes after submitting
 * but before reading the response. The key is embedded in the on-chain
 * memo field, making dedup verifiable from chain state alone.
 *
 * TOCTOU limitation: Two concurrent CLI calls with the same key can both
 * pass the dedup check before either's TX lands. Idempotency protects
 * against sequential retries (after Sui's ~400ms finality), not concurrent
 * execution. For atomic check-and-set, use the on-chain IdempotencyRegistry
 * (V9 contracts, see TODO.md).
 */

import { fromBase64 } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { CliError } from "./context.js";

const IDEMPOTENCY_PREFIX = "swee:idempotency:";

export interface ExistingReceipt {
  receiptId: string;
  txDigest?: string;
  recipient?: string;
  amount?: string;
  memo?: string;
}

/**
 * Decode a memo field from Sui RPC response.
 * Move's `vector<u8>` is serialized as Base64 by the JSON RPC.
 * Returns the UTF-8 decoded string, or undefined if decoding fails.
 */
function decodeMemo(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const bytes = fromBase64(raw);
    return new TextDecoder().decode(bytes);
  } catch {
    // If it's not valid base64, try using it as-is (future-proofing
    // for if the contract type changes to String)
    return raw;
  }
}

/** Check if a memo contains an exact idempotency segment (not a substring). */
function memoContainsKey(memo: string, needle: string): boolean {
  // Memo format: "swee:idempotency:KEY" or "user text | swee:idempotency:KEY"
  const segments = memo.split(" | ");
  return segments.some((s) => s === needle);
}

/**
 * Check if a payment with this idempotency key already exists on-chain.
 * Returns the existing receipt if found, null otherwise.
 *
 * Strategy: query sender's PaymentReceipt objects (newest-first) and filter by memo.
 * Sui returns owned objects in reverse-creation order by default, so crash-retry
 * scenarios (where the matching receipt was just created) typically resolve on the
 * first page — O(1) for the common case, O(n) worst-case.
 *
 * For high-volume senders (1000+ receipts), consider upgrading to an on-chain
 * IdempotencyRegistry with dynamic fields for O(1) guaranteed lookup (V9 contracts).
 */
export async function checkIdempotencyKey(
  client: SuiJsonRpcClient,
  senderAddress: string,
  packageId: string,
  idempotencyKey: string,
  expectedRecipient: string,
  expectedAmount: bigint,
  /** Skip recipient/amount conflict check (used by pay-402 where these are unknown until the 402 probe). */
  skipConflictCheck = false,
): Promise<ExistingReceipt | null> {
  const memoNeedle = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const typePrefix = `${packageId}::payment::PaymentReceipt`;

  // Safety bound: scan at most 20 pages (~1000 receipts). If the key isn't found
  // by then, it almost certainly doesn't exist. This prevents runaway RPC calls
  // for whale senders. Strategy 3 (dynamic field registry) eliminates this limit.
  const MAX_PAGES = 20;
  let cursor: string | null | undefined = undefined;
  let hasNext = true;
  let pageCount = 0;

  while (hasNext && pageCount < MAX_PAGES) {
    pageCount++;
    const page = await client.getOwnedObjects({
      owner: senderAddress,
      filter: { MatchAll: [{ StructType: typePrefix }] },
      options: { showContent: true, showPreviousTransaction: true },
      cursor: cursor ?? undefined,
    });

    for (const obj of page.data) {
      const data = obj.data;
      const content = data?.content;
      if (!data || content?.dataType !== "moveObject") continue;

      const fields = content.fields as Record<string, unknown>;
      // Move memo is vector<u8> → RPC returns Base64. Decode to UTF-8.
      const memo = decodeMemo(fields.memo);

      // Exact segment match: memo is either exactly the needle, or "user text | <needle>"
      // Using includes() would cause "key1" to match "key10" — split on delimiter instead.
      if (memo && memoContainsKey(memo, memoNeedle)) {
        const receipt: ExistingReceipt = {
          receiptId: data.objectId,
          txDigest: data.previousTransaction ?? undefined,
          recipient: typeof fields.recipient === "string" ? fields.recipient : undefined,
          amount: typeof fields.amount === "string" ? fields.amount : String(fields.amount ?? ""),
          memo,
        };

        // Conflict check: same key but different recipient or amount
        // Skipped for pay-402 where recipient/amount are unknown until the 402 probe
        if (!skipConflictCheck) {
          const receiptAmount = receipt.amount ? BigInt(receipt.amount) : undefined;
          if (
            (receipt.recipient && receipt.recipient !== expectedRecipient) ||
            (receiptAmount !== undefined && receiptAmount !== expectedAmount)
          ) {
            throw new CliError(
              "IDEMPOTENCY_CONFLICT",
              `Idempotency key "${idempotencyKey}" was already used with different parameters (recipient: ${receipt.recipient}, amount: ${receipt.amount})`,
              false,
              "Use a new UUID for a different payment. Idempotency keys are one-time-use per unique (recipient, amount) pair.",
              false,
            );
          }
        }

        return receipt;
      }
    }

    hasNext = page.hasNextPage;
    cursor = page.nextCursor;
  }

  return null;
}

/** Build the memo string for an idempotent payment. */
export function buildIdempotencyMemo(key: string, userMemo?: string): string {
  const idempotencyMemo = `${IDEMPOTENCY_PREFIX}${key}`;
  return userMemo ? `${userMemo} | ${idempotencyMemo}` : idempotencyMemo;
}

/** Validate idempotency key format (UUID-like). */
export function validateIdempotencyKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new CliError(
      "MISSING_ARGS",
      "Idempotency key cannot be empty",
      false,
      "Provide a UUID: --idempotency-key 550e8400-e29b-41d4-a716-446655440000",
    );
  }
  // Accept any non-empty string but warn-free for UUIDs (most common agent pattern)
  if (trimmed.length > 128) {
    throw new CliError(
      "INVALID_VALUE",
      "Idempotency key is too long (max 128 characters)",
      false,
      "Use a UUID or short identifier",
    );
  }
  return trimmed;
}
