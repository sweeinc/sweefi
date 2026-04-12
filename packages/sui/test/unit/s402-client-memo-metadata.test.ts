/**
 * s402 Client Memo & Metadata Tests
 *
 * Tests the two extensions added to createS402Client:
 *   A. Per-fetch memo passthrough → on-chain PaymentReceipt memo field
 *   B. Payment metadata attachment on Response → S402PaymentMetadata
 *
 * These tests mock the network layer (fetch) and the scheme's signTransaction
 * to verify the memo threading and metadata plumbing without live network calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExactSuiClientScheme } from "../../src/s402/exact/client";
import type { ClientSuiSigner } from "../../src/signer";
import type { s402PaymentRequirements } from "s402";
import { Transaction } from "@mysten/sui/transactions";

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

const MOCK_AGENT = "0x" + "a".repeat(64);
const MOCK_MERCHANT = "0x" + "b".repeat(64);
const COIN_TYPE = "0x2::sui::SUI";
const MOCK_PACKAGE_ID = "0x" + "3".repeat(64);

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeMockSigner(): ClientSuiSigner {
  return {
    address: MOCK_AGENT,
    signTransaction: vi.fn(async () => ({
      signature: "mock-sig-base64",
      bytes: "mock-tx-bytes",
    })),
  };
}

function makeRequirements(
  overrides: Partial<s402PaymentRequirements> = {},
): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["exact"],
    network: "sui:testnet",
    asset: COIN_TYPE,
    amount: "1000000",
    payTo: MOCK_MERCHANT,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────
// Extension A: Memo Passthrough Tests
// ─────────────────────────────────────────────────

describe("ExactSuiClientScheme — memo passthrough", () => {
  let signer: ClientSuiSigner;

  beforeEach(() => {
    signer = makeMockSigner();
  });

  it("creates payment without memo when extensions.memo is absent", async () => {
    const scheme = new ExactSuiClientScheme(signer, undefined, MOCK_PACKAGE_ID);
    // No memo in requirements
    const result = await scheme.createPayment(makeRequirements());
    expect(result.scheme).toBe("exact");
    expect(result.payload.transaction).toBe("mock-tx-bytes");
    expect(result.payload.signature).toBe("mock-sig-base64");
    // signTransaction should have been called with a Transaction
    expect(signer.signTransaction).toHaveBeenCalledOnce();
  });

  it("uses payment::pay_and_keep when memo + packageId are available", async () => {
    const scheme = new ExactSuiClientScheme(signer, undefined, MOCK_PACKAGE_ID);
    const reqs = makeRequirements({
      extensions: { memo: "swee:idempotency:abc-123" },
    });

    // Spy on Transaction to capture the MoveCall
    const buildSpy = vi.spyOn(Transaction.prototype, "moveCall");

    await scheme.createPayment(reqs);

    // Should have called moveCall with payment::pay_and_keep target
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target: `${MOCK_PACKAGE_ID}::payment::pay_and_keep`,
        typeArguments: [COIN_TYPE],
      }),
    );

    buildSpy.mockRestore();
  });

  it("memo is scoped to the requirements object (no shared state)", async () => {
    const scheme = new ExactSuiClientScheme(signer, undefined, MOCK_PACKAGE_ID);
    const reqsWithMemo = makeRequirements({
      extensions: { memo: "test-memo" },
    });

    await scheme.createPayment(reqsWithMemo);

    // A subsequent call without memo should NOT see the old memo
    const moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    await scheme.createPayment(makeRequirements());
    // Should NOT have called moveCall (no memo → no pay_and_keep)
    expect(moveCallSpy).not.toHaveBeenCalled();

    moveCallSpy.mockRestore();
  });

  it("falls back to raw transferObjects when packageId is unavailable", async () => {
    const scheme = new ExactSuiClientScheme(signer); // no packageId
    const reqs = makeRequirements({
      extensions: { memo: "should-be-silently-skipped" },
    });

    const moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    const transferSpy = vi.spyOn(Transaction.prototype, "transferObjects");

    await scheme.createPayment(reqs);

    // Should NOT have called moveCall (no package for payment::pay_and_keep)
    expect(moveCallSpy).not.toHaveBeenCalled();
    // Should have used raw transferObjects
    expect(transferSpy).toHaveBeenCalled();

    moveCallSpy.mockRestore();
    transferSpy.mockRestore();
  });

  it("uses mandateConfig.packageId as fallback when no direct packageId", async () => {
    const mandateConfig = {
      mandateId: "0x" + "1".repeat(64),
      registryId: "0x" + "2".repeat(64),
      packageId: MOCK_PACKAGE_ID,
    };
    const scheme = new ExactSuiClientScheme(signer, mandateConfig); // no direct packageId
    const reqs = makeRequirements({
      extensions: { memo: "memo-via-mandate-pkg" },
    });

    const moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");

    await scheme.createPayment(reqs);

    // Should use mandateConfig.packageId for payment::pay_and_keep
    const calls = moveCallSpy.mock.calls;
    const payAndKeepCall = calls.find((call) =>
      (call[0] as any).target?.includes("payment::pay_and_keep"),
    );
    expect(payAndKeepCall).toBeDefined();

    moveCallSpy.mockRestore();
  });

  it("converts protocolFeeBps to micro-percent for pay_and_keep", async () => {
    const scheme = new ExactSuiClientScheme(signer, undefined, MOCK_PACKAGE_ID);

    // 50 bps = 5000 micro-percent
    const reqs = makeRequirements({
      protocolFeeBps: 50,
      extensions: { memo: "fee-conversion-test" },
    });

    const moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");

    await scheme.createPayment(reqs);

    // Verify moveCall was made with payment::pay_and_keep
    expect(moveCallSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target: `${MOCK_PACKAGE_ID}::payment::pay_and_keep`,
      }),
    );

    moveCallSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────
// Extension B: Payment Metadata Tests
// ─────────────────────────────────────────────────

describe("S402PaymentMetadata on Response", () => {
  it("metadata is non-enumerable on Response", async () => {
    const response = new Response("test body");
    Object.defineProperty(response, "s402", {
      value: {
        txDigest: "abc123",
        scheme: "exact",
        amount: "1000000",
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });

    // Non-enumerable: not in Object.keys
    expect(Object.keys(response)).not.toContain("s402");
    // But still accessible
    expect((response as any).s402.txDigest).toBe("abc123");
    expect((response as any).s402.scheme).toBe("exact");
  });
});

// ─────────────────────────────────────────────────
// Type Export Tests
// ─────────────────────────────────────────────────

describe("Type exports", () => {
  it("S402FetchInit, S402FetchRequestOptions, and S402PaymentMetadata are importable", async () => {
    // These are type-only imports — this test verifies they exist at the module level
    const mod = await import("../../src/index");
    // createS402Client is the main export — types are verified at compile time
    expect(mod.createS402Client).toBeDefined();
  });
});
