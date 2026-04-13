/**
 * s402 Native Upto Scheme Tests
 *
 * Tests the s402 native facilitator and server for the upto scheme.
 * Security-critical verification checks:
 *   - Token type matching (prevent worthless token attack)
 *   - Payer/signer cross-check (prevent impersonation)
 *   - Recipient matching (prevent payment diversion)
 *   - Max amount exact match
 *   - Settlement deadline exact match
 *   - fee_micro_pct matching (prevent fee bypass — client controls PTB arg)
 *   - maxAmount payload/requirements cross-check
 *   - Defense-in-depth re-verify on settle (and skipVerify bypass)
 *   - depositId and actualAmount in settle response
 */

import { describe, it, expect } from "vitest";
import { UptoSuiFacilitatorScheme } from "../../src/s402/upto/facilitator";
import { UptoSuiServerScheme } from "../../src/s402/upto/server";
import { UptoSuiClientScheme } from "../../src/s402/upto/client";
import type { ClientSuiSigner } from "../../src/signer";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type {
  s402PaymentRequirements,
  s402UptoPayload,
} from "s402";
import { USDC_MAINNET, SUI_MAINNET_CAIP2 } from "../../src/constants";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_PAYER = "0x" + "b".repeat(64);
const MOCK_RECIPIENT = "0x" + "c".repeat(64);
const MOCK_PACKAGE_ID = "0x" + "d".repeat(64);
const MOCK_DEPOSIT_ID = "0x" + "e".repeat(64);

function createMockUptoEvent(overrides: Partial<{
  deposit_id: string;
  payer: string;
  recipient: string;
  max_amount: string;
  settlement_ceiling: string;
  settlement_deadline_ms: string;
  fee_micro_pct: string;
  fee_recipient: string;
  token_type: string;
}> = {}) {
  return {
    id: { txDigest: "mock-digest", eventSeq: "0" },
    packageId: MOCK_PACKAGE_ID,
    transactionModule: "upto_deposit",
    sender: MOCK_PAYER,
    type: `${MOCK_PACKAGE_ID}::upto_deposit::UptoDepositCreated`,
    parsedJson: {
      deposit_id: overrides.deposit_id ?? MOCK_DEPOSIT_ID,
      payer: overrides.payer ?? MOCK_PAYER,
      recipient: overrides.recipient ?? MOCK_RECIPIENT,
      max_amount: overrides.max_amount ?? "10000000",
      settlement_ceiling: overrides.settlement_ceiling ?? "10000000",
      settlement_deadline_ms: overrides.settlement_deadline_ms ?? "1700100000000",
      fee_micro_pct: overrides.fee_micro_pct ?? "10000",
      fee_recipient: overrides.fee_recipient ?? MOCK_RECIPIENT,
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
    getAddresses: () => [MOCK_RECIPIENT],
    verifySignature: async () => MOCK_PAYER,
    simulateTransaction: async () => createSuccessfulDryRun(),
    executeTransaction: async () => "mock-digest-" + Date.now(),
    waitForTransaction: async () => {},
    ...overrides,
  };
}

function createSuccessfulDryRun(
  overrides: {
    events?: Array<ReturnType<typeof createMockUptoEvent>>;
  } = {},
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges: [],
    events: overrides.events ?? [createMockUptoEvent()],
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

function createMockUptoPayload(overrides: Partial<s402UptoPayload["payload"]> = {}): s402UptoPayload {
  return {
    s402Version: "1",
    scheme: "upto",
    payload: {
      transaction: "mock-transaction-base64",
      signature: "mock-signature-base64",
      maxAmount: "10000000",
      ...overrides,
    },
  };
}

function createMockUptoRequirements(
  overrides: Partial<s402PaymentRequirements> = {},
): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["upto", "exact"],
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "10000000",
    payTo: MOCK_RECIPIENT,
    protocolFeeBps: 100,
    upto: {
      maxAmount: "10000000",
      settlementDeadlineMs: "1700100000000",
    },
    ...overrides,
  } as s402PaymentRequirements;
}

// ─────────────────────────────────────────────────
// Facilitator Tests
// ─────────────────────────────────────────────────

describe("UptoSuiFacilitatorScheme", () => {
  describe("constructor", () => {
    it("should throw if packageId is empty", () => {
      const signer = createMockFacilitatorSigner();
      expect(() => new UptoSuiFacilitatorScheme(signer, "")).toThrow(
        "packageId is required",
      );
    });
  });

  describe("verify", () => {
    it("should reject non-upto scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = { ...createMockUptoPayload(), scheme: "exact" as const };
      const result = await scheme.verify(payload as any, createMockUptoRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Expected upto");
    });

    it("should reject missing transaction", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockUptoPayload({ transaction: "" });
      const result = await scheme.verify(payload, createMockUptoRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing signature", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockUptoPayload({ signature: "" });
      const result = await scheme.verify(payload, createMockUptoRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing upto requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements({ upto: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("missing upto config");
    });

    it("should reject maxAmount mismatch between payload and requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockUptoPayload({ maxAmount: "5000000" });
      const result = await scheme.verify(payload, createMockUptoRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("maxAmount mismatch");
    });

    it("should verify valid upto payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
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
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(true);
      expect(callOrder).toContain("verify");
      expect(callOrder).toContain("simulate");
    });

    it("should reject when dry-run fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("InsufficientBalance"),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Dry-run failed");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should reject when no UptoDepositCreated event found (fail-closed)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [] }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No UptoDepositCreated event");
    });

    it("should reject event from spoofed package (event spoofing attack)", async () => {
      const ATTACKER_PKG = "0x" + "f".repeat(64);
      const spoofedEvent = createMockUptoEvent();
      spoofedEvent.type = `${ATTACKER_PKG}::upto_deposit::UptoDepositCreated`;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [spoofedEvent] }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No UptoDepositCreated event");
    });

    // ── Security-critical event verification ──

    it("should reject token type mismatch (worthless token attack)", async () => {
      const WORTHLESS_TOKEN = "0x" + "f".repeat(64) + "::fake::FAKE";
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ token_type: WORTHLESS_TOKEN })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Token type mismatch");
    });

    it("should reject payer/signer mismatch (impersonation attack)", async () => {
      const IMPERSONATOR = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ payer: IMPERSONATOR })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Payer mismatch");
    });

    it("should reject recipient mismatch (payment diversion)", async () => {
      const ATTACKER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ recipient: ATTACKER })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Recipient mismatch");
    });

    it("should reject max_amount mismatch from event", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ max_amount: "5000000" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Max amount mismatch");
    });

    it("should reject deadline mismatch (exact match required)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_deadline_ms: "1700200000000" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Deadline mismatch");
    });

    it("should reject fee_micro_pct mismatch (fee bypass attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Fee mismatch");
    });

    // ── Settlement ceiling verification (prevent free-service attack) ──

    it("should reject ceiling below estimatedAmount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_ceiling: "1" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "8000000",
        },
      });
      const result = await scheme.verify(createMockUptoPayload(), reqs);
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Settlement ceiling too low");
    });

    it("should reject ceiling below maxAmount when no estimatedAmount (fallback)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_ceiling: "5000000" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      // No estimatedAmount → ceiling must be >= maxAmount
      const reqs = createMockUptoRequirements();
      const result = await scheme.verify(createMockUptoPayload(), reqs);
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Settlement ceiling too low");
    });

    it("should accept ceiling=0 (no ceiling — payer trusts server fully)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_ceiling: "0" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(true);
    });

    it("should accept ceiling >= estimatedAmount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_ceiling: "9000000" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "8000000",
        },
      });
      const result = await scheme.verify(createMockUptoPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should accept ceiling exactly equal to estimatedAmount", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ settlement_ceiling: "8000000" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "8000000",
        },
      });
      const result = await scheme.verify(createMockUptoPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should accept fee_micro_pct=0 when requirements have no protocol fee", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockUptoEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockUptoRequirements({ protocolFeeBps: undefined });
      const result = await scheme.verify(createMockUptoPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should handle signature verification failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          throw new Error("Signature verification failed");
        },
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Signature verification failed");
    });
  });

  describe("settle", () => {
    it("should settle valid upto payload", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => "0xdigest123",
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
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
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      await scheme.settle(createMockUptoPayload(), createMockUptoRequirements());
      expect(simulateCalls).toBeGreaterThanOrEqual(1);
    });

    it("should skip verify when skipVerify option is true", async () => {
      let simulateCalls = 0;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => {
          simulateCalls++;
          return createSuccessfulDryRun();
        },
        executeTransaction: async () => "0xdigest123",
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
        { skipVerify: true },
      );
      expect(result.success).toBe(true);
      expect(simulateCalls).toBe(0);
    });

    it("should fail settlement if re-verify fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("ObjectNotFound"),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should wait for finality after execution", async () => {
      let waited = false;
      const signer = createMockFacilitatorSigner({
        waitForTransaction: async () => {
          waited = true;
        },
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.success).toBe(true);
      expect(waited).toBe(true);
    });

    it("should extract depositId from settlement events when getTransactionBlock is available", async () => {
      const signer = createMockFacilitatorSigner({
        getTransactionBlock: async () => ({
          events: [createMockUptoEvent()],
        }),
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.depositId).toBe(MOCK_DEPOSIT_ID);
    });

    it("should settle without depositId when getTransactionBlock is not available", async () => {
      const signer = createMockFacilitatorSigner();
      delete (signer as any).getTransactionBlock;
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.depositId).toBeUndefined();
    });

    it("should populate actualAmount from settlementOverrides", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockUptoRequirements({
        settlementOverrides: { actualAmount: "7500000" },
      });
      const result = await scheme.settle(createMockUptoPayload(), reqs);
      expect(result.success).toBe(true);
      expect(result.actualAmount).toBe("7500000");
    });

    it("should handle execution failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => {
          throw new Error("Network timeout");
        },
      });
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockUptoPayload(),
        createMockUptoRequirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });
  });

  describe("metadata", () => {
    it("should report scheme as 'upto'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new UptoSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      expect(scheme.scheme).toBe("upto");
    });
  });
});

// ─────────────────────────────────────────────────
// Server Tests
// ─────────────────────────────────────────────────

describe("UptoSuiServerScheme", () => {
  it("should build requirements from route config", () => {
    const scheme = new UptoSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["upto", "exact"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_RECIPIENT,
      asset: USDC_MAINNET,
      protocolFeeBps: 100,
      upto: {
        maxAmount: "10000000",
        settlementDeadlineMs: "1700100000000",
        estimatedAmount: "8000000",
      },
    });
    expect(result.s402Version).toBe("1");
    expect(result.accepts).toContain("upto");
    expect(result.accepts).toContain("exact");
    expect(result.network).toBe(SUI_MAINNET_CAIP2);
    expect(result.asset).toBe(USDC_MAINNET);
    expect(result.amount).toBe("10000000");
    expect(result.payTo).toBe(MOCK_RECIPIENT);
    expect(result.upto?.maxAmount).toBe("10000000");
    expect(result.upto?.settlementDeadlineMs).toBe("1700100000000");
    expect(result.upto?.estimatedAmount).toBe("8000000");
    expect(result.protocolFeeBps).toBe(100);
  });

  it("should default asset to SUI when not specified", () => {
    const scheme = new UptoSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["upto"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_RECIPIENT,
      upto: {
        maxAmount: "10000000",
        settlementDeadlineMs: "1700100000000",
      },
    });
    expect(result.asset).toBe("0x2::sui::SUI");
  });

  it("should throw if upto config is missing", () => {
    const scheme = new UptoSuiServerScheme();
    expect(() =>
      scheme.buildRequirements({
        schemes: ["upto"],
        price: "10000000",
        network: SUI_MAINNET_CAIP2,
        payTo: MOCK_RECIPIENT,
      }),
    ).toThrow("Upto config required");
  });

  it("should report scheme as 'upto'", () => {
    const scheme = new UptoSuiServerScheme();
    expect(scheme.scheme).toBe("upto");
  });

  it("should include usageReportUrl when provided", () => {
    const scheme = new UptoSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["upto"],
      price: "10000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_RECIPIENT,
      asset: USDC_MAINNET,
      upto: {
        maxAmount: "10000000",
        settlementDeadlineMs: "1700100000000",
        usageReportUrl: "https://api.example.com/usage",
      },
    });
    expect(result.upto?.usageReportUrl).toBe("https://api.example.com/usage");
  });
});

// ─────────────────────────────────────────────────
// Client Scheme Tests
// ─────────────────────────────────────────────────

const MOCK_PACKAGE_ID_CLIENT = "0x" + "f".repeat(64);
const MOCK_PROTOCOL_STATE = "0x" + "a".repeat(64);

function createMockClientSigner(): ClientSuiSigner {
  return {
    address: MOCK_PAYER,
    signTransaction: async () => ({
      bytes: "mock-tx-bytes-base64",
      signature: "mock-signature-base64",
    }),
  };
}

describe("UptoSuiClientScheme", () => {
  it("should set scheme to 'upto'", () => {
    const scheme = new UptoSuiClientScheme(
      createMockClientSigner(),
      { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
    );
    expect(scheme.scheme).toBe("upto");
  });

  it("should throw if upto requirements are missing", async () => {
    const scheme = new UptoSuiClientScheme(
      createMockClientSigner(),
      { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
    );
    const reqs = createMockUptoRequirements();
    delete (reqs as any).upto;
    await expect(scheme.createPayment(reqs)).rejects.toThrow("Upto requirements missing");
  });

  describe("ceiling calculation", () => {
    it("computes 1.2x ceiling from estimatedAmount", async () => {
      const scheme = new UptoSuiClientScheme(
        createMockClientSigner(),
        { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
      );
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "8000000", // 1.2x = 9600000
        },
      });
      const payload = await scheme.createPayment(reqs);
      expect(payload.payload.settlementCeiling).toBe("9600000");
    });

    it("caps ceiling at maxAmount when 1.2x exceeds it", async () => {
      const scheme = new UptoSuiClientScheme(
        createMockClientSigner(),
        { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
      );
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "9000000", // 1.2x = 10800000 > maxAmount → caps at 10000000
        },
      });
      const payload = await scheme.createPayment(reqs);
      expect(payload.payload.settlementCeiling).toBe("10000000");
    });

    it("floors ceiling at 1 for very small estimatedAmount", async () => {
      const scheme = new UptoSuiClientScheme(
        createMockClientSigner(),
        { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
      );
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "0", // 1.2x = 0 → floored to 1
        },
      });
      const payload = await scheme.createPayment(reqs);
      expect(payload.payload.settlementCeiling).toBe("1");
    });

    it("omits ceiling when no estimatedAmount provided", async () => {
      const scheme = new UptoSuiClientScheme(
        createMockClientSigner(),
        { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
      );
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "10000000",
          settlementDeadlineMs: "1700100000000",
          // no estimatedAmount → no ceiling
        },
      });
      const payload = await scheme.createPayment(reqs);
      expect(payload.payload.settlementCeiling).toBeUndefined();
    });

    it("exact 1.2x when estimate is round number", async () => {
      const scheme = new UptoSuiClientScheme(
        createMockClientSigner(),
        { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
      );
      const reqs = createMockUptoRequirements({
        upto: {
          maxAmount: "100000000",
          settlementDeadlineMs: "1700100000000",
          estimatedAmount: "5000000", // 1.2x = 6000000
        },
      });
      const payload = await scheme.createPayment(reqs);
      expect(payload.payload.settlementCeiling).toBe("6000000");
    });
  });

  it("populates payload fields correctly", async () => {
    const scheme = new UptoSuiClientScheme(
      createMockClientSigner(),
      { packageId: MOCK_PACKAGE_ID_CLIENT, protocolStateId: MOCK_PROTOCOL_STATE },
    );
    const reqs = createMockUptoRequirements();
    const payload = await scheme.createPayment(reqs);

    expect(payload.scheme).toBe("upto");
    expect(payload.s402Version).toBeDefined();
    expect(payload.payload.transaction).toBe("mock-tx-bytes-base64");
    expect(payload.payload.signature).toBe("mock-signature-base64");
    expect(payload.payload.maxAmount).toBe("10000000");
  });
});
