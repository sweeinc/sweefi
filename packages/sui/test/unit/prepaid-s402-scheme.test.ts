/**
 * s402 Native Prepaid Scheme Tests
 *
 * Tests the s402 native facilitator, server, and client for the prepaid scheme.
 * These are the implementations that ship in the npm package — security-critical.
 *
 * Key verification checks:
 *   - Event-based deposit verification (no balance-change inspection)
 *   - Provider mismatch detection (F-01: prevents free-service attack)
 *   - Minimum deposit enforcement
 *   - Rate/maxCalls commitment matching
 *   - Defense-in-depth re-verify on settle
 */

import { describe, it, expect } from "vitest";
import { PrepaidSuiFacilitatorScheme } from "../../src/s402/prepaid/facilitator";
import { PrepaidSuiServerScheme } from "../../src/s402/prepaid/server";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type {
  s402PaymentRequirements,
  s402PrepaidPayload,
} from "s402";
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
  fee_micro_pct: string;
  token_type: string;
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
      fee_micro_pct: overrides.fee_micro_pct ?? "10000", // 100 bps × 100 = 10000 micro-percent
      token_type: overrides.token_type ?? USDC_MAINNET,
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
  } = {},
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges: [],
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

function createMockS402PrepaidPayload(): s402PrepaidPayload {
  return {
    s402Version: "1",
    scheme: "prepaid",
    payload: {
      transaction: "mock-transaction-base64",
      signature: "mock-signature-base64",
      ratePerCall: "1000000",
      maxCalls: "100",
    },
  };
}

function createMockS402Requirements(
  overrides: Partial<s402PaymentRequirements> = {},
): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["prepaid", "exact"],
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "10000000",
    payTo: MOCK_PAYTO,
    protocolFeeBps: 100,
    prepaid: {
      ratePerCall: "1000000",
      maxCalls: "100",
      minDeposit: "10000000",
      withdrawalDelayMs: "3600000",
    },
    ...overrides,
  } as s402PaymentRequirements;
}

// ─────────────────────────────────────────────────
// Facilitator Tests (s402 native)
// ─────────────────────────────────────────────────

describe("PrepaidSuiFacilitatorScheme (s402 native)", () => {
  describe("verify", () => {
    it("should reject non-prepaid scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = { ...createMockS402PrepaidPayload(), scheme: "exact" as const };
      const result = await scheme.verify(payload as any, createMockS402Requirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Expected prepaid");
    });

    it("should reject missing transaction", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockS402PrepaidPayload();
      payload.payload.transaction = "";
      const result = await scheme.verify(payload, createMockS402Requirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing signature", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockS402PrepaidPayload();
      payload.payload.signature = "";
      const result = await scheme.verify(payload, createMockS402Requirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing prepaid requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements({ prepaid: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("missing prepaid config");
    });

    it("should reject rate mismatch", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockS402PrepaidPayload();
      payload.payload.ratePerCall = "999999";
      const result = await scheme.verify(payload, createMockS402Requirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Rate mismatch");
    });

    it("should reject maxCalls mismatch when requirements specify it", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockS402PrepaidPayload();
      payload.payload.maxCalls = "50";
      const result = await scheme.verify(payload, createMockS402Requirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("MaxCalls mismatch");
    });

    it("should verify valid prepaid payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(true);
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should run signature verification and simulation in parallel", async () => {
      const callOrder: string[] = [];
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          callOrder.push("verify");
          return MOCK_PAYER;
        },
        simulateTransaction: async () => {
          callOrder.push("simulate");
          return createSuccessfulDryRun();
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(true);
      expect(callOrder).toContain("verify");
      expect(callOrder).toContain("simulate");
    });

    it("should reject when dry-run fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("InsufficientBalance"),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Dry-run failed");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    // ── Event-based verification tests (security-critical) ──

    it("should reject when deposit uses wrong token type (worthless token attack)", async () => {
      const WORTHLESS_TOKEN = "0x" + "f".repeat(64) + "::fake::FAKE";
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ token_type: WORTHLESS_TOKEN })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Token type mismatch");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should reject when agent does not match signer (impersonation attack)", async () => {
      const IMPERSONATED = "0x" + "1".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ agent: IMPERSONATED })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Agent mismatch");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should reject when deposit targets wrong provider (F-01: free-service attack)", async () => {
      const ATTACKER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: ATTACKER })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Provider mismatch");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should reject when deposit targets self as provider (F-01: self-refund attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: MOCK_PAYER })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Provider mismatch");
    });

    it("should reject deposit below minimum via event amount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ amount: "5000000" })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("below minimum");
    });

    it("should accept deposit at exactly minimum via event amount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ amount: "10000000" })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(true);
    });

    it("should reject fee_micro_pct mismatch (fee bypass attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Fee mismatch");
    });

    it("should accept fee_micro_pct=0 when requirements have no protocol fee", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockS402Requirements({ protocolFeeBps: undefined });
      const result = await scheme.verify(createMockS402PrepaidPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should reject event from spoofed package (C-1: event spoofing attack)", async () => {
      const ATTACKER_PKG = "0x" + "f".repeat(64);
      const spoofedEvent = createMockDepositEvent();
      // Change the event type to come from an attacker's package
      spoofedEvent.type = `${ATTACKER_PKG}::prepaid::PrepaidDeposited`;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [spoofedEvent] }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No PrepaidDeposited event");
    });

    it("should reject when no PrepaidDeposited event found (fail-closed)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [] }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No PrepaidDeposited event");
    });

    it("should handle signature verification failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          throw new Error("Signature verification failed");
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Signature verification failed");
    });

    it("should handle unexpected errors gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => {
          throw new Error("Network unreachable");
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Network unreachable");
    });
  });

  describe("settle", () => {
    it("should settle valid prepaid payload", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => "0xdigest123",
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(true);
      expect(result.txDigest).toBe("0xdigest123");
      expect(result.finalityMs).toBeGreaterThanOrEqual(0);
    });

    it("should re-verify before broadcasting (defense-in-depth)", async () => {
      let simulateCalls = 0;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => {
          simulateCalls++;
          return createSuccessfulDryRun();
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      await scheme.settle(createMockS402PrepaidPayload(), createMockS402Requirements());
      // settle calls verify which calls simulateTransaction
      expect(simulateCalls).toBeGreaterThanOrEqual(1);
    });

    it("should fail settlement if re-verify fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("ObjectNotFound"),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should fail settlement if provider mismatch on re-verify", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockDepositEvent({ provider: MOCK_PAYER })],
          }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(false);
    });

    it("should handle execution failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => {
          throw new Error("Network timeout");
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });

    it("should wait for finality after execution", async () => {
      let waited = false;
      const signer = createMockFacilitatorSigner({
        waitForTransaction: async () => {
          waited = true;
        },
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(true);
      expect(waited).toBe(true);
    });

    // ── balanceId extraction (F-05) ──

    it("should extract balanceId from settlement events when getTransactionBlock is available", async () => {
      const BALANCE_ID = "0x" + "e".repeat(64);
      const signer = createMockFacilitatorSigner({
        getTransactionBlock: async () => ({
          events: [createMockDepositEvent()],
        }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(true);
      expect(result.balanceId).toBe(BALANCE_ID);
    });

    it("should settle without balanceId when getTransactionBlock is not available", async () => {
      // Default mock signer has no getTransactionBlock
      const signer = createMockFacilitatorSigner();
      delete (signer as any).getTransactionBlock;
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(true);
      expect(result.balanceId).toBeUndefined();
    });

    it("should settle without balanceId when event extraction fails", async () => {
      const signer = createMockFacilitatorSigner({
        getTransactionBlock: async () => ({
          events: [], // no deposit event
        }),
      });
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockS402PrepaidPayload(),
        createMockS402Requirements(),
      );
      expect(result.success).toBe(true);
      expect(result.balanceId).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it("should report scheme as 'prepaid'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      expect(scheme.scheme).toBe("prepaid");
    });
  });
});

// ─────────────────────────────────────────────────
// Server Tests (s402 native)
// ─────────────────────────────────────────────────

describe("PrepaidSuiServerScheme (s402 native)", () => {
  it("should build requirements from route config", () => {
    const scheme = new PrepaidSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["prepaid", "exact"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      asset: USDC_MAINNET,
      prepaid: {
        ratePerCall: "1000000",
        maxCalls: "100",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.s402Version).toBe("1");
    expect(result.accepts).toContain("prepaid");
    expect(result.network).toBe(SUI_MAINNET_CAIP2);
    expect(result.asset).toBe(USDC_MAINNET);
    expect(result.amount).toBe("10000000");
    expect(result.payTo).toBe(MOCK_PAYTO);
    expect(result.prepaid?.ratePerCall).toBe("1000000");
    expect(result.prepaid?.maxCalls).toBe("100");
    expect(result.prepaid?.minDeposit).toBe("10000000");
    expect(result.prepaid?.withdrawalDelayMs).toBe("3600000");
  });

  it("should default asset to USDC when not specified", () => {
    const scheme = new PrepaidSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["prepaid"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.asset).toBe(USDC_MAINNET);
  });

  it("should throw if prepaid config is missing", () => {
    const scheme = new PrepaidSuiServerScheme();
    expect(() =>
      scheme.buildRequirements({
        schemes: ["prepaid"],
        price: "10000000",
        network: SUI_MAINNET_CAIP2,
        payTo: MOCK_PAYTO,
      }),
    ).toThrow("requires prepaid section");
  });

  it("should include protocol fee when specified", () => {
    const scheme = new PrepaidSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["prepaid"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      protocolFeeBps: 100,
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.protocolFeeBps).toBe(100);
  });

  it("should omit maxCalls when not specified in config", () => {
    const scheme = new PrepaidSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["prepaid"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.prepaid?.maxCalls).toBeUndefined();
  });

  it("should report scheme as 'prepaid'", () => {
    const scheme = new PrepaidSuiServerScheme();
    expect(scheme.scheme).toBe("prepaid");
  });

  // ─── v0.2 Server Tests ───────────────────────

  it("should include v0.2 fields when receiptConfig is provided", () => {
    const scheme = new PrepaidSuiServerScheme({
      providerPubkey: "a".repeat(64),
      disputeWindowMs: "300000",
    });
    const result = scheme.buildRequirements({
      schemes: ["prepaid"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.prepaid?.providerPubkey).toBe("a".repeat(64));
    expect(result.prepaid?.disputeWindowMs).toBe("300000");
  });

  it("should omit v0.2 fields when no receiptConfig (v0.1 mode)", () => {
    const scheme = new PrepaidSuiServerScheme(); // no constructor args
    const result = scheme.buildRequirements({
      schemes: ["prepaid"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_PAYTO,
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
      },
    });
    expect(result.prepaid?.providerPubkey).toBeUndefined();
    expect(result.prepaid?.disputeWindowMs).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────
// v0.2: Facilitator providerPubkey validation
// ─────────────────────────────────────────────────

describe("PrepaidSuiFacilitatorScheme — v0.2 pubkey validation", () => {
  it("should accept valid 64-hex-char providerPubkey in requirements", async () => {
    const signer = createMockFacilitatorSigner();
    const facilitator = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);

    const requirements = createMockS402Requirements({
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
        providerPubkey: "a".repeat(64),
        disputeWindowMs: "300000",
      },
    });

    const result = await facilitator.verify(createMockS402PrepaidPayload(), requirements);
    expect(result.valid).toBe(true);
  });

  it("should accept 0x-prefixed providerPubkey", async () => {
    const signer = createMockFacilitatorSigner();
    const facilitator = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);

    const requirements = createMockS402Requirements({
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
        providerPubkey: "0x" + "b".repeat(64),
        disputeWindowMs: "300000",
      },
    });

    const result = await facilitator.verify(createMockS402PrepaidPayload(), requirements);
    expect(result.valid).toBe(true);
  });

  it("should reject malformed providerPubkey (wrong length)", async () => {
    const signer = createMockFacilitatorSigner();
    const facilitator = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);

    const requirements = createMockS402Requirements({
      prepaid: {
        ratePerCall: "1000000",
        minDeposit: "10000000",
        withdrawalDelayMs: "3600000",
        providerPubkey: "abcd", // too short
        disputeWindowMs: "300000",
      },
    });

    const result = await facilitator.verify(createMockS402PrepaidPayload(), requirements);
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("Invalid providerPubkey format");
  });

  it("should still work without providerPubkey (v0.1 backward compat)", async () => {
    const signer = createMockFacilitatorSigner();
    const facilitator = new PrepaidSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);

    // Standard v0.1 requirements — no providerPubkey
    const requirements = createMockS402Requirements();
    const result = await facilitator.verify(createMockS402PrepaidPayload(), requirements);
    expect(result.valid).toBe(true);
  });
});
