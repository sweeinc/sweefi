/**
 * Exact Scheme Mandate Integration Tests
 *
 * Tests the createPayment() mandate branching in ExactSuiClientScheme:
 *   - Mandate required + configured → PTB includes validate_and_spend
 *   - Mandate required + NOT configured → throws clear error
 *   - Mandate not required → no mandate moveCall
 *   - Mandate + gas station in same PTB → both applied
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ExactSuiClientScheme } from "../../src/s402/exact/client";
import { Transaction } from "@mysten/sui/transactions";
import type { ClientSuiSigner } from "../../src/signer";
import type { s402PaymentRequirements } from "s402";

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

const MOCK_AGENT = "0x" + "a".repeat(64);
const MOCK_MERCHANT = "0x" + "b".repeat(64);
const COIN_TYPE = "0x2::sui::SUI";
const MOCK_MANDATE_ID = "0x" + "1".repeat(64);
const MOCK_REGISTRY_ID = "0x" + "2".repeat(64);
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

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe("ExactSuiClientScheme.createPayment() — mandate integration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let moveCallSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setGasOwnerSpy: any;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes validate_and_spend moveCall when mandate is required and configured", async () => {
    moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer, {
      mandateId: MOCK_MANDATE_ID,
      registryId: MOCK_REGISTRY_ID,
      packageId: MOCK_PACKAGE_ID,
    });

    await scheme.createPayment(
      makeRequirements({ mandate: { required: true } }),
    );

    // moveCall should have been called with the validate_and_spend target
    expect(moveCallSpy).toHaveBeenCalledTimes(1);
    const callArgs = moveCallSpy.mock.calls[0][0] as any;
    expect(callArgs.target).toBe(`${MOCK_PACKAGE_ID}::mandate::validate_and_spend`);
    expect(callArgs.typeArguments).toEqual([COIN_TYPE]);

    // Verify argument count and order match Move signature:
    // validate_and_spend(mandate, amount, registry, clock) — ctx is implicit
    const args = callArgs.arguments;
    expect(args).toHaveLength(4);
  });

  it("throws when mandate required but no mandateConfig", async () => {
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer); // no mandateConfig

    await expect(
      scheme.createPayment(makeRequirements({ mandate: { required: true } })),
    ).rejects.toThrow("Server requires mandate authorization");
  });

  it("does NOT include moveCall when mandate is not required", async () => {
    moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer, {
      mandateId: MOCK_MANDATE_ID,
      registryId: MOCK_REGISTRY_ID,
      packageId: MOCK_PACKAGE_ID,
    });

    await scheme.createPayment(makeRequirements()); // no mandate field

    // moveCall should NOT have been called (only transferObjects/splitCoins)
    expect(moveCallSpy).not.toHaveBeenCalled();
  });

  it("does NOT include moveCall when mandate.required is false", async () => {
    moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer, {
      mandateId: MOCK_MANDATE_ID,
      registryId: MOCK_REGISTRY_ID,
      packageId: MOCK_PACKAGE_ID,
    });

    await scheme.createPayment(
      makeRequirements({ mandate: { required: false } }),
    );

    expect(moveCallSpy).not.toHaveBeenCalled();
  });

  it("applies mandate AND fee split when both are present", async () => {
    moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    const splitCoinsSpy = vi.spyOn(Transaction.prototype, "splitCoins");
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer, {
      mandateId: MOCK_MANDATE_ID,
      registryId: MOCK_REGISTRY_ID,
      packageId: MOCK_PACKAGE_ID,
    });

    const feeAddr = "0x" + "f".repeat(64);
    await scheme.createPayment(
      makeRequirements({
        mandate: { required: true },
        protocolFeeBps: 500, // 5%
        protocolFeeAddress: feeAddr,
      }),
    );

    // Mandate moveCall should be present
    expect(moveCallSpy).toHaveBeenCalledTimes(1);
    expect(moveCallSpy.mock.calls[0][0].target).toBe(
      `${MOCK_PACKAGE_ID}::mandate::validate_and_spend`,
    );
    // Fee split should produce a splitCoins call
    expect(splitCoinsSpy).toHaveBeenCalledTimes(1);
  });

  it("applies both mandate AND gas station when both are present", async () => {
    moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    setGasOwnerSpy = vi.spyOn(Transaction.prototype, "setGasOwner");
    const signer = makeMockSigner();
    const scheme = new ExactSuiClientScheme(signer, {
      mandateId: MOCK_MANDATE_ID,
      registryId: MOCK_REGISTRY_ID,
      packageId: MOCK_PACKAGE_ID,
    });

    const sponsorAddr = "0x" + "d".repeat(64);
    await scheme.createPayment(
      makeRequirements({
        mandate: { required: true },
        extensions: { gasStation: { sponsorAddress: sponsorAddr, maxBudget: "10000000" } },
      }),
    );

    // Both mandate moveCall and gas sponsor should be applied
    expect(moveCallSpy).toHaveBeenCalledTimes(1);
    expect(setGasOwnerSpy).toHaveBeenCalledWith(sponsorAddr);
  });
});
