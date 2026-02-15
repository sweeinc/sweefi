import { describe, it, expect } from "vitest";
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
const MOCK_PACKAGE_ID = "0x" + "d".repeat(64);

function createMockDepositEvent(overrides: Partial<{
  provider: string;
  agent: string;
  amount: string;
  rate_per_call: string;
  max_calls: string;
}> = {}) {
  return {
    id: { txDigest: "mock-digest", eventSeq: "0" },
    packageId: MOCK_PACKAGE_ID,
    transactionModule: "prepaid",
    sender: MOCK_PAYER,
    type: `${MOCK_PACKAGE_ID}::prepaid::PrepaidDeposited`,
    parsedJson: {
      balance_id: "0x" + "e".repeat(64),
      agent: overrides.agent ?? MOCK_PAYER,
      provider: overrides.provider ?? MOCK_PAYTO,
      amount: overrides.amount ?? "10000000",
      rate_per_call: overrides.rate_per_call ?? "1000000",
      max_calls: overrides.max_calls ?? "100",
      token_type: USDC_MAINNET,
      timestamp_ms: "1700000000000",
    },
    bcs: "",
    bcsEncoding: "base64" as const,
    timestampMs: "1700000000000",
  };
}

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
  overrides: {
    events?: Array<ReturnType<typeof createMockDepositEvent>>;
    balanceChanges?: Array<{
      owner: { AddressOwner: string } | string;
      coinType: string;
      amount: string;
    }>;
  } = {},
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges: overrides.balanceChanges ?? [],
    events: overrides.events ?? [createMockDepositEvent()],
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mocks don't need strict x402 types
function createMockPrepaidPayload(network = SUI_MAINNET_CAIP2): any {
  return {
    x402Version: 2,
    resource: { url: "https://api.example.com/resource", description: "test", mimeType: "application/json" },
    accepted: {
      scheme: "prepaid",
      network,
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
    },
    payload: {
      signature: "mock-signature-base64",
      transaction: "mock-transaction-base64",
      ratePerCall: "1000000",
      maxCalls: "100",
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mocks don't need strict x402 types
function createMockPrepaidRequirements(overrides: Record<string, unknown> = {}): any {
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
// Facilitator Prepaid Scheme Tests (x402 compat)
// ─────────────────────────────────────────────────

describe("PrepaidSuiFacilitatorScheme (x402 compat)", () => {
  describe("verify", () => {
    it("should reject non-prepaid scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const base = createMockPrepaidPayload();
      const payload = { ...base, accepted: { ...base.accepted, scheme: "exact" } };
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
      payload.payload.ratePerCall = "999999";
      const result = await scheme.verify(payload, createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("rate_mismatch");
    });

    it("should reject maxCalls mismatch", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new FacilitatorPrepaidScheme(signer);
      const payload = createMockPrepaidPayload();
      payload.payload.maxCalls = "50";
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

    // ── Event-based verification tests (F-01, F-02, F-04) ──

    it("should reject when deposit targets wrong provider (F-01: free-service attack)", async () => {
      const ATTACKER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: ATTACKER })],
          }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("provider_mismatch");
    });

    it("should reject when deposit targets self as provider (F-01: self-refund attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: MOCK_PAYER })],
          }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("provider_mismatch");
    });

    it("should reject deposit below minimum via event amount (F-02)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ amount: "5000000" })],
          }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("deposit_below_minimum");
    });

    it("should accept deposit at exactly minimum via event amount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ amount: "10000000" })],
          }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(true);
    });

    it("should reject when no PrepaidDeposited event found (F-04: fail closed)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [] }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.verify(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("no_deposit_event");
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

    it("should fail settlement if provider mismatch on re-verify", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: MOCK_PAYER })],
          }),
      });
      const scheme = new FacilitatorPrepaidScheme(signer);
      const result = await scheme.settle(createMockPrepaidPayload(), createMockPrepaidRequirements());
      expect(result.success).toBe(false);
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
// Server Prepaid Scheme Tests (x402 compat)
// ─────────────────────────────────────────────────

describe("PrepaidSuiServerScheme (x402 compat)", () => {
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
        extra: {},
      } as any,
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
