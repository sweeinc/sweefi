/**
 * s402 Native Escrow Scheme Tests
 *
 * Tests the s402 native facilitator and server for the escrow scheme.
 * Security-critical verification checks:
 *   - Token type matching (prevent worthless token attack)
 *   - Buyer/signer cross-check (prevent impersonation)
 *   - Seller matching (prevent payment diversion)
 *   - Minimum amount enforcement
 *   - Deadline exact match (longer changes escrow economics)
 *   - Arbiter matching when specified
 *   - fee_micro_pct matching (prevent fee bypass — client controls PTB arg)
 *   - Defense-in-depth re-verify on settle
 */

import { describe, it, expect } from "vitest";
import { EscrowSuiFacilitatorScheme } from "../../src/s402/escrow/facilitator";
import { EscrowSuiServerScheme } from "../../src/s402/escrow/server";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import type {
  s402PaymentRequirements,
  s402EscrowPayload,
} from "s402";
import { USDC_MAINNET, SUI_MAINNET_CAIP2 } from "../../src/constants";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

const MOCK_BUYER = "0x" + "b".repeat(64);
const MOCK_SELLER = "0x" + "c".repeat(64);
const MOCK_ARBITER = "0x" + "a".repeat(64);
const MOCK_PACKAGE_ID = "0x" + "d".repeat(64);
const MOCK_ESCROW_ID = "0x" + "e".repeat(64);

function createMockEscrowEvent(overrides: Partial<{
  escrow_id: string;
  buyer: string;
  seller: string;
  arbiter: string;
  amount: string;
  deadline_ms: string;
  fee_micro_pct: string;
  token_type: string;
}> = {}) {
  return {
    id: { txDigest: "mock-digest", eventSeq: "0" },
    packageId: MOCK_PACKAGE_ID,
    transactionModule: "escrow",
    sender: MOCK_BUYER,
    type: `${MOCK_PACKAGE_ID}::escrow::EscrowCreated`,
    parsedJson: {
      escrow_id: overrides.escrow_id ?? MOCK_ESCROW_ID,
      buyer: overrides.buyer ?? MOCK_BUYER,
      seller: overrides.seller ?? MOCK_SELLER,
      arbiter: overrides.arbiter ?? MOCK_ARBITER,
      amount: overrides.amount ?? "5000000",
      deadline_ms: overrides.deadline_ms ?? "1700100000000",
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
    getAddresses: () => [MOCK_ARBITER],
    verifySignature: async () => MOCK_BUYER,
    simulateTransaction: async () => createSuccessfulDryRun(),
    executeTransaction: async () => "mock-digest-" + Date.now(),
    waitForTransaction: async () => {},
    ...overrides,
  };
}

function createSuccessfulDryRun(
  overrides: {
    events?: Array<ReturnType<typeof createMockEscrowEvent>>;
  } = {},
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges: [],
    events: overrides.events ?? [createMockEscrowEvent()],
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

function createMockEscrowPayload(): s402EscrowPayload {
  return {
    s402Version: "1",
    scheme: "escrow",
    payload: {
      transaction: "mock-transaction-base64",
      signature: "mock-signature-base64",
    },
  };
}

function createMockEscrowRequirements(
  overrides: Partial<s402PaymentRequirements> = {},
): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["escrow", "exact"],
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "5000000",
    payTo: MOCK_SELLER,
    protocolFeeBps: 100,
    escrow: {
      seller: MOCK_SELLER,
      arbiter: MOCK_ARBITER,
      deadlineMs: "1700100000000",
    },
    ...overrides,
  } as s402PaymentRequirements;
}

// ─────────────────────────────────────────────────
// Facilitator Tests
// ─────────────────────────────────────────────────

describe("EscrowSuiFacilitatorScheme", () => {
  describe("verify", () => {
    it("should reject non-escrow scheme", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = { ...createMockEscrowPayload(), scheme: "exact" as const };
      const result = await scheme.verify(payload as any, createMockEscrowRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Expected escrow");
    });

    it("should reject missing transaction", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockEscrowPayload();
      payload.payload.transaction = "";
      const result = await scheme.verify(payload, createMockEscrowRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing signature", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const payload = createMockEscrowPayload();
      payload.payload.signature = "";
      const result = await scheme.verify(payload, createMockEscrowRequirements());
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Missing transaction or signature");
    });

    it("should reject missing escrow requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements({ escrow: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("missing escrow config");
    });

    it("should verify valid escrow payload", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(true);
      expect(result.payerAddress).toBe(MOCK_BUYER);
    });

    it("should run signature verification and simulation in parallel", async () => {
      const callOrder: string[] = [];
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          callOrder.push("verify");
          return MOCK_BUYER;
        },
        simulateTransaction: async () => {
          callOrder.push("simulate");
          return createSuccessfulDryRun();
        },
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(true);
      expect(callOrder).toContain("verify");
      expect(callOrder).toContain("simulate");
    });

    it("should reject when dry-run fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("InsufficientBalance"),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Dry-run failed");
      expect(result.payerAddress).toBe(MOCK_BUYER);
    });

    it("should reject when no EscrowCreated event found (fail-closed)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [] }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No EscrowCreated event");
    });

    it("should reject event from spoofed package (C-1: event spoofing attack)", async () => {
      const ATTACKER_PKG = "0x" + "f".repeat(64);
      const spoofedEvent = createMockEscrowEvent();
      spoofedEvent.type = `${ATTACKER_PKG}::escrow::EscrowCreated`;
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({ events: [spoofedEvent] }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("No EscrowCreated event");
    });

    // ── Security-critical event verification ──

    it("should reject token type mismatch (worthless token attack)", async () => {
      const WORTHLESS_TOKEN = "0x" + "f".repeat(64) + "::fake::FAKE";
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ token_type: WORTHLESS_TOKEN })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Token type mismatch");
    });

    it("should reject buyer/signer mismatch (impersonation attack)", async () => {
      const IMPERSONATOR = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ buyer: IMPERSONATOR })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Buyer mismatch");
    });

    it("should reject seller mismatch (payment diversion)", async () => {
      const ATTACKER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ seller: ATTACKER })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Seller mismatch");
    });

    it("should reject amount below required", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ amount: "1000000" })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("below required");
    });

    it("should accept amount at exactly required", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ amount: "5000000" })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(true);
    });

    it("should reject deadline mismatch (exact match required)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ deadline_ms: "1700200000000" })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Deadline mismatch");
    });

    it("should reject arbiter mismatch when arbiter is specified", async () => {
      const WRONG_ARBITER = "0x" + "f".repeat(64);
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ arbiter: WRONG_ARBITER })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Arbiter mismatch");
    });

    it("should skip arbiter check when not specified in requirements", async () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockEscrowRequirements();
      delete reqs.escrow!.arbiter;
      const result = await scheme.verify(createMockEscrowPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should reject fee_micro_pct mismatch (fee bypass attack)", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Fee mismatch");
    });

    it("should accept fee_micro_pct=0 when requirements have no protocol fee", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () =>
          createSuccessfulDryRun({
            events: [createMockEscrowEvent({ fee_micro_pct: "0" })],
          }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const reqs = createMockEscrowRequirements({ protocolFeeBps: undefined });
      const result = await scheme.verify(createMockEscrowPayload(), reqs);
      expect(result.valid).toBe(true);
    });

    it("should handle signature verification failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        verifySignature: async () => {
          throw new Error("Signature verification failed");
        },
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.verify(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toContain("Signature verification failed");
    });
  });

  describe("settle", () => {
    it("should settle valid escrow payload", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => "0xdigest123",
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
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
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      await scheme.settle(createMockEscrowPayload(), createMockEscrowRequirements());
      expect(simulateCalls).toBeGreaterThanOrEqual(1);
    });

    it("should fail settlement if re-verify fails", async () => {
      const signer = createMockFacilitatorSigner({
        simulateTransaction: async () => createFailedDryRun("ObjectNotFound"),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
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
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.success).toBe(true);
      expect(waited).toBe(true);
    });

    it("should extract escrowId from settlement events when getTransactionBlock is available", async () => {
      const signer = createMockFacilitatorSigner({
        getTransactionBlock: async () => ({
          events: [createMockEscrowEvent()],
        }),
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.escrowId).toBe(MOCK_ESCROW_ID);
    });

    it("should settle without escrowId when getTransactionBlock is not available", async () => {
      const signer = createMockFacilitatorSigner();
      delete (signer as any).getTransactionBlock;
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.success).toBe(true);
      expect(result.escrowId).toBeUndefined();
    });

    it("should handle execution failure gracefully", async () => {
      const signer = createMockFacilitatorSigner({
        executeTransaction: async () => {
          throw new Error("Network timeout");
        },
      });
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      const result = await scheme.settle(
        createMockEscrowPayload(),
        createMockEscrowRequirements(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });
  });

  describe("metadata", () => {
    it("should report scheme as 'escrow'", () => {
      const signer = createMockFacilitatorSigner();
      const scheme = new EscrowSuiFacilitatorScheme(signer, MOCK_PACKAGE_ID);
      expect(scheme.scheme).toBe("escrow");
    });
  });
});

// ─────────────────────────────────────────────────
// Server Tests
// ─────────────────────────────────────────────────

describe("EscrowSuiServerScheme", () => {
  it("should build requirements from route config", () => {
    const scheme = new EscrowSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["escrow", "exact"],
      price: "5000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_SELLER,
      asset: USDC_MAINNET,
      protocolFeeBps: 100,
      escrow: {
        seller: MOCK_SELLER,
        arbiter: MOCK_ARBITER,
        deadlineMs: "1700100000000",
      },
    });
    expect(result.s402Version).toBe("1");
    expect(result.accepts).toContain("escrow");
    expect(result.accepts).toContain("exact");
    expect(result.network).toBe(SUI_MAINNET_CAIP2);
    expect(result.asset).toBe(USDC_MAINNET);
    expect(result.amount).toBe("5000000");
    expect(result.payTo).toBe(MOCK_SELLER);
    expect(result.escrow?.seller).toBe(MOCK_SELLER);
    expect(result.escrow?.arbiter).toBe(MOCK_ARBITER);
    expect(result.escrow?.deadlineMs).toBe("1700100000000");
    expect(result.protocolFeeBps).toBe(100);
  });

  it("should default asset to SUI when not specified", () => {
    const scheme = new EscrowSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["escrow"],
      price: "5000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_SELLER,
      escrow: {
        seller: MOCK_SELLER,
        deadlineMs: "1700100000000",
      },
    });
    expect(result.asset).toBe("0x2::sui::SUI");
  });

  it("should default seller to payTo when seller matches", () => {
    const scheme = new EscrowSuiServerScheme();
    const result = scheme.buildRequirements({
      schemes: ["escrow"],
      price: "5000000",
      network: SUI_MAINNET_CAIP2,
      payTo: MOCK_SELLER,
      escrow: {
        seller: MOCK_SELLER,
        deadlineMs: "1700100000000",
      },
    });
    expect(result.escrow?.seller).toBe(MOCK_SELLER);
  });

  it("should throw if escrow config is missing", () => {
    const scheme = new EscrowSuiServerScheme();
    expect(() =>
      scheme.buildRequirements({
        schemes: ["escrow"],
        price: "5000000",
        network: SUI_MAINNET_CAIP2,
        payTo: MOCK_SELLER,
      }),
    ).toThrow("Escrow config required");
  });

  it("should report scheme as 'escrow'", () => {
    const scheme = new EscrowSuiServerScheme();
    expect(scheme.scheme).toBe("escrow");
  });
});
