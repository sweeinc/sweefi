/**
 * Exact Scheme Fee Verification Tests
 *
 * Tests the two-branch balance-change verification in ExactSuiFacilitatorScheme.verify():
 *   - No fee split: payTo receives >= amount
 *   - Fee split: payTo receives >= (amount - fee), feeAddress receives >= fee
 *
 * Validates fix for F02 (CRITICAL): verify() previously rejected valid fee-split
 * transactions because it checked payTo >= full amount.
 */

import { describe, it, expect } from "vitest";
import { ExactSuiFacilitatorScheme } from "../../src/s402/exact/facilitator";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type { s402PaymentRequirements, s402ExactPayload } from "s402";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_PAYER = "0x" + "a".repeat(64);
const MOCK_MERCHANT = "0x" + "b".repeat(64);
const MOCK_FEE_ADDR = "0x" + "c".repeat(64);
const COIN_TYPE = "0x2::sui::SUI";

function makeBalanceChange(owner: string, amount: string, coinType = COIN_TYPE) {
  return { owner: { AddressOwner: owner }, coinType, amount };
}

function makeDryRunResult(
  balanceChanges: Array<{ owner: unknown; coinType: string; amount: string }>,
): DryRunTransactionBlockResponse {
  return {
    effects: { status: { status: "success" } },
    balanceChanges,
    // Minimal stubs for required fields
    events: [],
    objectChanges: [],
    input: {} as never,
  } as unknown as DryRunTransactionBlockResponse;
}

function makeMockSigner(dryRunResult: DryRunTransactionBlockResponse): FacilitatorSuiSigner {
  return {
    getAddresses: () => [],
    verifySignature: async () => MOCK_PAYER,
    simulateTransaction: async () => dryRunResult,
    executeTransaction: async () => "mock-digest",
    waitForTransaction: async () => {},
  };
}

function makeRequirements(overrides: Partial<s402PaymentRequirements> = {}): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["exact"],
    network: "sui:testnet",
    asset: COIN_TYPE,
    amount: "10000",
    payTo: MOCK_MERCHANT,
    ...overrides,
  };
}

function makePayload(): s402ExactPayload {
  return {
    s402Version: "1",
    scheme: "exact",
    payload: { transaction: "dHg=", signature: "c2ln" },
  };
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe("ExactSuiFacilitatorScheme.verify() — fee split", () => {
  it("passes when feeBps=0 and payTo receives full amount", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(makePayload(), makeRequirements());
    expect(result.valid).toBe(true);
  });

  it("passes with correct fee split (feeBps=500, separate feeAddress)", async () => {
    // 500 BPS = 5% fee. On 10000 MIST: fee=500, merchant=9500
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "9500"),
      makeBalanceChange(MOCK_FEE_ADDR, "500"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500, protocolFeeAddress: MOCK_FEE_ADDR }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when fee recipient underpaid", async () => {
    // Fee should be 500 but only received 100
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "9500"),
      makeBalanceChange(MOCK_FEE_ADDR, "100"),
      makeBalanceChange(MOCK_PAYER, "-9600"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500, protocolFeeAddress: MOCK_FEE_ADDR }),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Protocol fee 100 below required 500");
  });

  it("rejects when merchant underpaid in fee-split mode", async () => {
    // Merchant should get 9500 but only got 5000
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "5000"),
      makeBalanceChange(MOCK_FEE_ADDR, "500"),
      makeBalanceChange(MOCK_PAYER, "-5500"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500, protocolFeeAddress: MOCK_FEE_ADDR }),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Merchant amount 5000 below required 9500");
  });

  it("uses full-amount check when feeAddress === payTo (merged balance changes)", async () => {
    // When feeAddress === payTo, Sui merges into one balance change
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"), // merchant gets full amount (merchant + fee merged)
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500, protocolFeeAddress: MOCK_MERCHANT }),
    );
    // Falls into the "no fee split" branch (feeAddress === payTo)
    expect(result.valid).toBe(true);
  });

  it("uses full-amount check when no protocolFeeAddress is set", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500 }),
    );
    // Falls into "no fee split" branch (no protocolFeeAddress)
    expect(result.valid).toBe(true);
  });

  it("rejects when payTo receives nothing in no-fee mode", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_PAYER, "-10000"),
      // Merchant gets nothing
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(makePayload(), makeRequirements());
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Recipient did not receive expected coin type");
  });

  it("passes when merchant overpays in fee-split mode", async () => {
    // Merchant gets 9600 (more than required 9500), fee gets 500 — both sufficient
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "9600"),
      makeBalanceChange(MOCK_FEE_ADDR, "500"),
      makeBalanceChange(MOCK_PAYER, "-10100"),
    ]);
    const scheme = new ExactSuiFacilitatorScheme(makeMockSigner(dryRun));

    const result = await scheme.verify(
      makePayload(),
      makeRequirements({ protocolFeeBps: 500, protocolFeeAddress: MOCK_FEE_ADDR }),
    );
    expect(result.valid).toBe(true);
  });
});
