/**
 * s402 Native Stream Scheme Tests
 *
 * Tests the s402 native facilitator for the stream scheme.
 * Security-critical verification checks:
 *   - Token type matching (prevent worthless token attack)
 *   - Payer/signer cross-check (prevent impersonation)
 *   - Recipient matching (prevent payment diversion)
 *   - Minimum deposit enforcement
 *   - Rate matching (prevent cheap-rate attack)
 *   - Budget cap enforcement
 *   - Defense-in-depth re-verify on settle
 */

import { describe, it, expect } from "vitest";
import { StreamSuiFacilitatorScheme } from "../../src/s402/stream/facilitator";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type {
  s402PaymentRequirements,
  s402StreamPayload,
} from "s402";
import { USDC_MAINNET, SUI_MAINNET_CAIP2 } from "../../src/constants";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_PAYER = "0x" + "b".repeat(64);
const MOCK_PAYTO = "0x" + "c".repeat(64);
const MOCK_PACKAGE_ID = "0x" + "d".repeat(64);
const MOCK_METER_ID = "0x" + "e".repeat(64);

function createMockStreamEvent(overrides: Partial<{
  meter_id: string;
  payer: string;
  recipient: string;
  deposit: string;
  rate_per_second: string;
  budget_cap: string;
  fee_micro_pct: string;
  token_type: string;
}> = {}) {
  return {
    id: { txDigest: "mock-digest", eventSeq: "0" },
    packageId: MOCK_PACKAGE_ID,
    transactionModule: "stream",
    sender: MOCK_PAYER,
    type: `${MOCK_PACKAGE_ID}::stream::StreamCreated`,
    parsedJson: {
      meter_id: overrides.meter_id ?? MOCK_METER_ID,
      payer: overrides.payer ?? MOCK_PAYER,
      recipient: overrides.recipient ?? MOCK_PAYTO,
      deposit: overrides.deposit ?? "10000000",
      rate_per_second: overrides.rate_per_second ?? "1000",
      budget_cap: overrides.budget_cap ?? "100000000",
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
    events?: Array<ReturnType<typeof createMockStreamEvent>>;
  } = {},
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges: [],
    events: overrides.events ?? [createMockStreamEvent()],
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

function createMockStreamPayload(): s402StreamPayload {
  return {
    s402Version: "1",
    scheme: "stream",
    payload: {
      transaction: "mock-transaction-base64",
      signature: "mock-signature-base64",
    },
  };
}

function createMockStreamRequirements(
  overrides: Partial<s402PaymentRequirements> = {},
): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["stream", "exact"],
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "10000000",
    payTo: MOCK_PAYTO,
    protocolFeeBps: 100,
    stream: {
      ratePerSecond: "1000",
      budgetCap: "100000000",
      minDeposit: "10000000",
    },
    ...overrides,
  } as s402PaymentRequirements;
}

// ─────────────────────────────────────────────────
// Facilitator Tests
// ─────────────────────────────────────────────────

describe("StreamSuiFacilitatorScheme", () => {
  describe("verify", () => {
    it("should reject non-stream scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = { ...createMockStreamPayload(), scheme: "exact" as const };
      const result = await scheme.verify(payload as any, createMockStreamRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Expected stream");
    });

    it("should reject missing transaction", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockStreamPayload();
      payload.payload.transaction = "";
      const result = await scheme.verify(payload, createMockStreamRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing signature", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockStreamPayload();
      payload.payload.signature = "";
      const result = await scheme.verify(payload, createMockStreamRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing stream requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements({ stream: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("missing stream config");
    });

    it("should verify valid stream payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
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
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(true);
      expect(callOrder).toContain("verify");
      expect(callOrder).toContain("simulate");
    });

    it("should reject when dry-run fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("InsufficientBalance"),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Dry-run failed");
      expect(result.payerAddress).toBe(MOCK_PAYER);
    });

    it("should reject event from spoofed package (C-1: event spoofing attack)", async () => {
      const ATTACKER_PKG = "0x" + "f".repeat(64);
      const spoofedEvent = createMockStreamEvent();
      spoofedEvent.type = `${ATTACKER_PKG}::stream::StreamCreated`;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [spoofedEvent] }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No StreamCreated event");
    });

    it("should reject when no StreamCreated event found (fail-closed)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [] }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No StreamCreated event");
    });

    // ── Security-critical event verification ──

    it("should reject token type mismatch (worthless token attack)", async () => {
      const WORTHLESS_TOKEN = "0x" + "f".repeat(64) + "::fake::FAKE";
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ token_type: WORTHLESS_TOKEN })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Token type mismatch");
    });

    it("should reject payer/signer mismatch (impersonation attack)", async () => {
      const IMPERSONATOR = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ payer: IMPERSONATOR })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Payer mismatch");
    });

    it("should reject recipient mismatch (payment diversion)", async () => {
      const ATTACKER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ recipient: ATTACKER })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Recipient mismatch");
    });

    it("should reject deposit below minimum", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ deposit: "5000000" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("below minimum");
    });

    it("should accept deposit at exactly minimum", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ deposit: "10000000" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(true);
    });

    it("should reject rate mismatch (cheap-rate attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ rate_per_second: "1" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Rate mismatch");
    });

    it("should reject budget cap below required", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ budget_cap: "50000000" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Budget cap");
    });

    it("should accept budget cap at exactly required", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ budget_cap: "100000000" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(true);
    });

    it("should reject fee_micro_pct mismatch (fee bypass attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Fee mismatch");
    });

    it("should accept fee_micro_pct=0 when requirements have no protocol fee", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockStreamEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockStreamRequirements({ protocolFeeBps: undefined });
      const result = await scheme.verify(createMockStreamPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should handle signature verification failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          throw new Error("Signature verification failed");
        },
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Signature verification failed");
    });
  });

  describe("settle", () => {
    it("should settle valid stream payload", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => "0xdigest123",
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
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
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      await scheme.settle(createMockStreamPayload(), createMockStreamRequirements());
      expect(simulateCalls).toBeGreaterThanOrEqual(1);
    });

    it("should fail settlement if re-verify fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("ObjectNotFound"),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
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
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.success).toBe(true);
      expect(waited).toBe(true);
    });

    it("should extract streamId from settlement events when getTransactionBlock is available", async () => {
      const signer = createMockFacilitatorSigner({
        getTransactionBlock: async () => ({
          events: [createMockStreamEvent()],
        }),
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.streamId).toBe(MOCK_METER_ID);
    });

    it("should settle without streamId when getTransactionBlock is not available", async () => {
      const signer = createMockFacilitatorSigner();
      delete (signer as any).getTransactionBlock;
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.streamId).toBeUndefined();
    });

    it("should handle execution failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => {
          throw new Error("Network timeout");
        },
      });
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockStreamPayload(),
        createMockStreamRequirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });
  });

  describe("metadata", () => {
    it("should report scheme as 'stream'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new StreamSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      expect(scheme.scheme).toBe("stream");
    });
  });
});
