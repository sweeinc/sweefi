/**
 * Exact Scheme Gas Sponsorship Tests
 *
 * Tests the settle() gas sponsorship logic in ExactSuiFacilitatorScheme:
 *   - Sponsored tx detection via gasData.owner matching
 *   - Gas budget cap enforcement (zero-budget bypass + over-cap)
 *   - Dual-signature co-signing when sponsored
 *   - Graceful fallback when sponsor not configured
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ExactSuiFacilitatorScheme, DEFAULT_MAX_SPONSOR_GAS_BUDGET } from "../../src/s402/exact/facilitator";
import { Transaction } from "@mysten/sui/transactions";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type { s402PaymentRequirements, s402ExactPayload } from "s402";

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

const MOCK_PAYER = "0x" + "a".repeat(64);
const MOCK_MERCHANT = "0x" + "b".repeat(64);
const MOCK_SPONSOR = "0x" + "d".repeat(64);
const COIN_TYPE = "0x2::sui::SUI";

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeBalanceChange(owner: string, amount: string, coinType = COIN_TYPE) {
  return { owner: { AddressOwner: owner }, coinType, amount };
}

function makeDryRunResult(
  balanceChanges: Array<{ owner: unknown; coinType: string; amount: string }>,
): DryRunTransactionBlockResponse {
  return {
    effects: { status: { status: "success" } },
    balanceChanges,
    events: [],
    objectChanges: [],
    input: {} as never,
  } as unknown as DryRunTransactionBlockResponse;
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

/** Create a mock signer WITH gas sponsorship capability. */
function makeSponsorSigner(
  dryRunResult: DryRunTransactionBlockResponse,
  sponsorAddress: string = MOCK_SPONSOR,
): FacilitatorSuiSigner {
  return {
    getAddresses: () => [sponsorAddress],
    verifySignature: async () => MOCK_PAYER,
    simulateTransaction: async () => dryRunResult,
    executeTransaction: vi.fn(async () => "mock-digest"),
    waitForTransaction: async () => {},
    sponsorSign: vi.fn(async () => "sponsor-sig-base64"),
  };
}

/** Create a mock signer WITHOUT gas sponsorship. */
function makeBasicSigner(dryRunResult: DryRunTransactionBlockResponse): FacilitatorSuiSigner {
  return {
    getAddresses: () => [],
    verifySignature: async () => MOCK_PAYER,
    simulateTransaction: async () => dryRunResult,
    executeTransaction: vi.fn(async () => "mock-digest"),
    waitForTransaction: async () => {},
  };
}

/**
 * Mock Transaction.from() to return controlled gasData.
 * The real Transaction.from() needs valid BCS bytes, but for unit tests
 * we only care about gasData.owner and gasData.budget.
 */
function mockTransactionFrom(
  gasOwner: string | null,
  gasBudget: string | number = "10000000",
  commands: Array<{ $kind: string; [key: string]: unknown }> = [],
) {
  return vi.spyOn(Transaction, "from").mockReturnValue({
    getData: () => ({
      commands,
      gasData: {
        owner: gasOwner,
        budget: String(gasBudget),
      },
    }),
  } as any);
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe("ExactSuiFacilitatorScheme.settle() — gas sponsorship", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("co-signs and returns gasSponsored=true when gasOwner matches sponsor", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // Mock Transaction.from to return gasOwner matching sponsor
    mockTransactionFrom(MOCK_SPONSOR, "5000000");

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    expect((result as any).gasSponsored).toBe(true);
    expect(signer.sponsorSign).toHaveBeenCalledWith("dHg=");
    // executeTransaction receives [clientSig, sponsorSig]
    expect(signer.executeTransaction).toHaveBeenCalledWith(
      "dHg=",
      ["c2ln", "sponsor-sig-base64"],
      "sui:testnet",
    );
  });

  it("uses single signature when gasOwner does NOT match sponsor", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // gasOwner is some other address
    const otherAddr = "0x" + "e".repeat(64);
    mockTransactionFrom(otherAddr, "5000000");

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    expect((result as any).gasSponsored).toBe(false);
    expect(signer.sponsorSign).not.toHaveBeenCalled();
    // executeTransaction receives single string (not array)
    expect(signer.executeTransaction).toHaveBeenCalledWith(
      "dHg=",
      "c2ln",
      "sui:testnet",
    );
  });

  it("uses single signature when sponsor is not configured", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeBasicSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // No need to mock Transaction.from — sponsor path won't execute
    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    expect((result as any).gasSponsored).toBe(false);
  });

  it("rejects when gas budget exceeds sponsor cap", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    // Set cap to 5M MIST
    const scheme = new ExactSuiFacilitatorScheme(signer, 5_000_000n);

    // Client requests 10M budget, which exceeds 5M cap
    mockTransactionFrom(MOCK_SPONSOR, "10000000");

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds sponsor limit");
    expect(signer.sponsorSign).not.toHaveBeenCalled();
  });

  it("rejects zero gas budget (zero-budget bypass defense)", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // Attacker sets budget to 0 to bypass cap check
    mockTransactionFrom(MOCK_SPONSOR, "0");

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    expect(result.error).toContain("zero or missing");
    expect(signer.sponsorSign).not.toHaveBeenCalled();
  });

  it("propagates error when sponsorSign throws", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    (signer.sponsorSign as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Keypair signing failed"),
    );
    const scheme = new ExactSuiFacilitatorScheme(signer);

    mockTransactionFrom(MOCK_SPONSOR, "5000000");

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Keypair signing failed");
  });

  it("rejects sponsored tx that references GasCoin (drain prevention)", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // Simulate attacker crafting SplitCoins(GasCoin, [amount]) to drain sponsor's coin
    mockTransactionFrom(MOCK_SPONSOR, "5000000", [
      {
        $kind: "SplitCoins",
        SplitCoins: {
          coin: { $kind: "GasCoin" },
          amounts: [{ $kind: "Input", Input: 0 }],
        },
      },
      {
        $kind: "TransferObjects",
        TransferObjects: {
          objects: [{ $kind: "Result", Result: 0 }],
          address: { $kind: "Input", Input: 1 },
        },
      },
    ]);

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(false);
    expect(result.error).toContain("GasCoin");
    expect(result.error).toContain("not allowed");
    expect(signer.sponsorSign).not.toHaveBeenCalled();
  });

  it("allows sponsored tx with no GasCoin references (normal payment)", async () => {
    const dryRun = makeDryRunResult([
      makeBalanceChange(MOCK_MERCHANT, "10000"),
      makeBalanceChange(MOCK_PAYER, "-10000"),
    ]);
    const signer = makeSponsorSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);

    // Normal payment: SplitCoins on an Input coin, not GasCoin
    mockTransactionFrom(MOCK_SPONSOR, "5000000", [
      {
        $kind: "SplitCoins",
        SplitCoins: {
          coin: { $kind: "Input", Input: 0 },
          amounts: [{ $kind: "Input", Input: 1 }],
        },
      },
      {
        $kind: "TransferObjects",
        TransferObjects: {
          objects: [{ $kind: "Result", Result: 0 }],
          address: { $kind: "Input", Input: 2 },
        },
      },
    ]);

    const result = await scheme.settle(makePayload(), makeRequirements());

    expect(result.success).toBe(true);
    expect((result as any).gasSponsored).toBe(true);
    expect(signer.sponsorSign).toHaveBeenCalled();
  });
});

describe("ExactSuiFacilitatorScheme — DEFAULT_MAX_SPONSOR_GAS_BUDGET", () => {
  it("exports the default as 10M MIST (0.01 SUI)", () => {
    expect(DEFAULT_MAX_SPONSOR_GAS_BUDGET).toBe(10_000_000n);
  });

  it("uses the default when no cap is provided to constructor", () => {
    const dryRun = makeDryRunResult([]);
    const signer = makeBasicSigner(dryRun);
    const scheme = new ExactSuiFacilitatorScheme(signer);
    // Access via reflection — the private field should equal the default
    expect((scheme as any).maxSponsorGasBudget).toBe(DEFAULT_MAX_SPONSOR_GAS_BUDGET);
  });

  it("respects custom cap when provided", () => {
    const dryRun = makeDryRunResult([]);
    const signer = makeBasicSigner(dryRun);
    const customCap = 50_000_000n;
    const scheme = new ExactSuiFacilitatorScheme(signer, customCap);
    expect((scheme as any).maxSponsorGasBudget).toBe(customCap);
  });
});
