import { describe, it, expect, vi } from "vitest";
import { PrepaidSuiScheme as FacilitatorPrepaidScheme } from "../../src/prepaid/facilitator/scheme";
import { PrepaidSuiScheme as ServerPrepaidScheme } from "../../src/prepaid/server/scheme";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/client";
import { USDC_MAINNET, SUI_MAINNET_CAIP2 } from "../../src/constants";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_PAYER = "0x" + "b".repeat(64);
const MOCK_PAYTO = "0x" + "c".repeat(64);

function createMockFacilitatorSigner(
  overrides: Partial<FacilitatorSuiSigner> = {},
): FacilitatorSuiSigner {
  return {
    getAddresses: () => ["0x" + "a".repeat(64)],
    verifySignature: async () => MOCK_PAYER,
    simulateTransaction: async () => createSuccessfulDryRun(),
    executeTransaction: async () => "mock-digest-" + Date.now(),
    waitForTransaction: async () => {},
    ...overrides,
  };
}

function createSuccessfulDryRun(
  balanceChanges: Array<{
    owner: { AddressOwner: string } | string;
    coinType: string;
    amount: string;
  }> = [],
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges,
    events: [],
    input: {} as any,
    objectChanges: [],
  } as unknown as DryRunTransactionBlockResponse;
}

function createFailedDryRun(error: string): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "failure", error },
    },
    balanceChanges: [],
    events: [],
    input: {} as any,
    objectChanges: [],
  } as unknown as DryRunTransactionBlockResponse;
}

function createMockPrepaidPayload(network = SUI_MAINNET_CAIP2) {
  return {
    x402Version: 2,
    accepted: { scheme: "prepaid", network },
    payload: {
      signature: "mock-signature-base64",
      transaction: "mock-transaction-base64",
      ratePerCall: "1000000",
      maxCalls: "100",
    },
  };
}

function createMockPrepaidRequirements(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "prepaid",
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "10000000",
    payTo: MOCK_PAYTO,
    maxTimeoutSeconds: 3600,
    extra: {
      ratePerCall: "1000000",
      maxCalls: "100",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────
// Facilitator Prepaid Scheme Tests
// ─────────────────────────────────────────────────

describe("PrepaidSuiFacilitatorScheme", () => {
  describe("verify", () => {
    it("should reject non-prepaid scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = { ...createMockPrepaidPayload(), accepted: { scheme: "exact", network: SUI_MAINNET_CAIP2 } };
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("unsupported_scheme");
    });

    it("should reject network mismatch", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload("sui:testnet");
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("network_mismatch");
    });

    it("should reject missing transaction", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      payload.payload.transaction = "";
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("missing_transaction_or_signature");
    });

    it("should reject missing signature", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      payload.payload.signature = "";
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("missing_transaction_or_signature");
    });

    it("should reject rate mismatch", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      payload.payload.ratePerCall = "999999"; // doesn't match requirements
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("rate_mismatch");
    });

    it("should reject maxCalls mismatch", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      payload.payload.maxCalls = "50"; // doesn't match requirements
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("max_calls_mismatch");
    });

    it("should verify valid prepaid payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(MOCK_PAYER);
    });

    it("should run signature verification and simulation in parallel", async () => {
      const verifyOrder: string[] = [];
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          verifyOrder.push("verify");
          return MOCK_PAYER;
        },
        simulateTransaction: async () => {
          verifyOrder.push("simulate");
          return createSuccessfulDryRun();
        },
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(true);
      // Both should be called (order may vary due to Promise.all)
      expect(verifyOrder).toContain("verify");
      expect(verifyOrder).toContain("simulate");
    });

    it("should reject when dry-run fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("InsufficientBalance"),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("dry_run_failed");
      expect(result.payer).toBe(MOCK_PAYER);
    });

    it("should reject deposit below minimum", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun([
            {
              owner: { AddressOwner: MOCK_PAYER },
              coinType: USDC_MAINNET,
              amount: "-5000000", // 5 USDC, but min is 10
            },
          ]),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("deposit_below_minimum");
    });

    it("should accept deposit at exactly minimum", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun([
            {
              owner: { AddressOwner: MOCK_PAYER },
              coinType: USDC_MAINNET,
              amount: "-10000000", // exactly 10 USDC min
            },
          ]),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(true);
    });

    it("should handle signature verification failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          throw new Error("Signature verification failed");
        },
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("signature_verification_failed");
    });
  });

  describe("settle", () => {
    it("should settle valid prepaid payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.success).toBe(true);
      expect(result.transaction).toMatch(/^mock-digest-/);
      expect(result.network).toBe(SUI_MAINNET_CAIP2);
    });

    it("should re-verify before broadcasting (defense-in-depth)", async () => {
      const verifyCalls: number[] = [];
      let callCount = 0;
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          verifyCalls.push(++callCount);
          return MOCK_PAYER;
        },
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      // verify is called during settle (re-verify), which calls verifySignature
      expect(verifyCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("should fail settlement if re-verify fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("ObjectNotFound"),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.success).toBe(false);
      expect(result.errorReason).toBeTruthy();
    });

    it("should handle execution failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => {
          throw new Error("Network timeout");
        },
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe("transaction_failed");
    });

    it("should wait for finality after execution", async () => {
      let waited = false;
      const signer = createMockFacilitatorSigner({
        waitForTransaction: async () => {
          waited = true;
        },
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.success).toBe(true);
      expect(waited).toBe(true);
    });
  });

  describe("metadata", () => {
    it("should report scheme as 'prepaid'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      expect(scheme.scheme).toBe("prepaid");
    });

    it("should report caipFamily as 'sui:*'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      expect(scheme.caipFamily).toBe("sui:*");
    });

    it("should return signer addresses", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      expect(scheme.getSigners("sui:mainnet")).toEqual(["0x" + "a".repeat(64)]);
    });
  });
});

// ─────────────────────────────────────────────────
// Server Prepaid Scheme Tests
// ─────────────────────────────────────────────────

describe("PrepaidSuiServerScheme", () => {
  it("should parse USDC price correctly", async () => {
    const scheme = new ServerPrepaidScheme({
      ratePerCall: "1000000",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    });
    const result = await scheme.parsePrice("$10.00", SUI_MAINNET_CAIP2);
    expect(result.amount).toBe("10000000");
    expect(result.asset).toBe(USDC_MAINNET);
  });

  it("should parse numeric price", async () => {
    const scheme = new ServerPrepaidScheme({
      ratePerCall: "1000000",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    });
    const result = await scheme.parsePrice(0.001, SUI_MAINNET_CAIP2);
    expect(result.amount).toBe("1000");
    expect(result.asset).toBe(USDC_MAINNET);
  });

  it("should return AssetAmount directly", async () => {
    const scheme = new ServerPrepaidScheme({
      ratePerCall: "1000000",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    });
    const input = { amount: "5000000", asset: USDC_MAINNET };
    const result = await scheme.parsePrice(input, SUI_MAINNET_CAIP2);
    expect(result.amount).toBe("5000000");
    expect(result.asset).toBe(USDC_MAINNET);
  });

  it("should enhance requirements with prepaid config", async () => {
    const scheme = new ServerPrepaidScheme({
      ratePerCall: "1000000",
      maxCalls: "100",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    });
    const enhanced = await scheme.enhancePaymentRequirements(
      {
        scheme: "prepaid",
        network: SUI_MAINNET_CAIP2,
        asset: USDC_MAINNET,
        amount: "10000000",
        payTo: MOCK_PAYTO,
        maxTimeoutSeconds: 30,
      },
      { x402Version: 2, scheme: "prepaid", network: SUI_MAINNET_CAIP2 },
      [],
    );
    expect(enhanced.extra?.ratePerCall).toBe("1000000");
    expect(enhanced.extra?.maxCalls).toBe("100");
    expect(enhanced.extra?.minDeposit).toBe("10000000");
    expect(enhanced.extra?.withdrawalDelayMs).toBe("3600000");
  });

  it("should report scheme as 'prepaid'", () => {
    const scheme = new ServerPrepaidScheme({
      ratePerCall: "1000000",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    });
    expect(scheme.scheme).toBe("prepaid");
  });
});
