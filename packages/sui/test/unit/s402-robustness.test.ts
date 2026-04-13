/**
 * s402 Scheme Adapter Robustness Tests
 *
 * Tests edge cases in scheme negotiation, input validation within adapters,
 * and behavior with malformed/missing requirements.
 *
 * Security findings documented inline with severity ratings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Transaction } from "@mysten/sui/transactions";

// Client schemes
import { ExactSuiClientScheme } from "../../src/s402/exact/client";
import { StreamSuiClientScheme } from "../../src/s402/stream/client";
import { EscrowSuiClientScheme } from "../../src/s402/escrow/client";
import { PrepaidSuiClientScheme } from "../../src/s402/prepaid/client";
import { UnlockSuiClientScheme } from "../../src/s402/unlock/client";

// Facilitator schemes
import { ExactSuiFacilitatorScheme, DEFAULT_MAX_SPONSOR_GAS_BUDGET } from "../../src/s402/exact/facilitator";
import { StreamSuiFacilitatorScheme } from "../../src/s402/stream/facilitator";
import { EscrowSuiFacilitatorScheme } from "../../src/s402/escrow/facilitator";
import { PrepaidSuiFacilitatorScheme } from "../../src/s402/prepaid/facilitator";

// Server schemes
import { StreamSuiServerScheme } from "../../src/s402/stream/server";
import { EscrowSuiServerScheme } from "../../src/s402/escrow/server";
import { PrepaidSuiServerScheme } from "../../src/s402/prepaid/server";

// Direct settlement
import { DirectSuiSettlement } from "../../src/s402/direct";

import type { SweefiConfig } from "../../src/ptb/types";
import type { s402PaymentRequirements, s402RouteConfig } from "s402";

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const PACKAGE_ID = "0x" + "ab".repeat(32);
const PROTOCOL_STATE_ID = "0x" + "99".repeat(32);
const SENDER = "0x" + "11".repeat(32);
const RECIPIENT = "0x" + "22".repeat(32);

const sweefiConfig: SweefiConfig = {
  packageId: PACKAGE_ID,
  protocolStateId: PROTOCOL_STATE_ID,
};

// Mock signer for client schemes
function createMockSigner(address = SENDER) {
  return {
    address,
    signTransaction: vi.fn().mockResolvedValue({
      signature: "mock-signature-base64",
      bytes: "mock-transaction-bytes-base64",
    }),
  };
}

// Mock signer for facilitator schemes
function createMockFacilitatorSigner() {
  return {
    verifySignature: vi.fn().mockResolvedValue(SENDER),
    simulateTransaction: vi.fn().mockResolvedValue({
      effects: { status: { status: "success" } },
      balanceChanges: [],
      events: [],
    }),
    executeTransaction: vi.fn().mockResolvedValue("mock-tx-digest"),
    waitForTransaction: vi.fn().mockResolvedValue(undefined),
    getAddresses: vi.fn().mockReturnValue([]),
  };
}

// Base valid requirements
function createBaseRequirements(overrides: Partial<s402PaymentRequirements> = {}): s402PaymentRequirements {
  return {
    s402Version: "1",
    accepts: ["exact"],
    network: "sui:testnet",
    asset: "0x2::sui::SUI",
    amount: "1000000",
    payTo: RECIPIENT,
    ...overrides,
  } as s402PaymentRequirements;
}

// ══════════════════════════════════════════════════════════════
// ExactSuiClientScheme — Robustness
// ══════════════════════════════════════════════════════════════

describe("ExactSuiClientScheme robustness", () => {
  it("creates payment with minimal requirements (no fees, no mandate)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer);
    const requirements = createBaseRequirements();

    const result = await scheme.createPayment(requirements);

    expect(result.scheme).toBe("exact");
    expect(result.payload.transaction).toBeDefined();
    expect(result.payload.signature).toBeDefined();
    expect(signer.signTransaction).toHaveBeenCalledOnce();
  });

  it("throws when mandate required but no mandateConfig", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer); // no mandateConfig

    const requirements = createBaseRequirements({
      mandate: { required: true },
    } as Partial<s402PaymentRequirements>);

    await expect(scheme.createPayment(requirements)).rejects.toThrow("mandate");
  });

  it("memo is scoped to requirements (no shared mutable state)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer, undefined, PACKAGE_ID);

    // First call with memo
    await scheme.createPayment(createBaseRequirements({
      extensions: { memo: "test-memo" },
    }));

    // Second call without memo — should not see the old memo
    const moveCallSpy = vi.spyOn(Transaction.prototype, "moveCall");
    await scheme.createPayment(createBaseRequirements());
    expect(moveCallSpy).not.toHaveBeenCalled();
    moveCallSpy.mockRestore();
  });

  it("warns but does not throw when memo set without packageId", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer); // no packageId
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await scheme.createPayment(createBaseRequirements({
      extensions: { memo: "test-memo" },
    }));

    expect(result.scheme).toBe("exact");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("memo provided but packageId not configured"),
    );
    warnSpy.mockRestore();
  });

  it("handles zero protocolFeeBps correctly (no fee split)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer);

    const requirements = createBaseRequirements({ protocolFeeBps: 0 });
    const result = await scheme.createPayment(requirements);

    expect(result.scheme).toBe("exact");
  });

  it("handles protocolFeeBps without protocolFeeAddress (defaults to payTo)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer);

    const requirements = createBaseRequirements({
      protocolFeeBps: 100,
      // protocolFeeAddress intentionally omitted
    });
    const result = await scheme.createPayment(requirements);

    expect(result.scheme).toBe("exact");
  });

  // FINDING S-01 (FIXED): Empty string amount now throws early validation error.
  // BigInt("") is 0n which fails the `totalAmount <= 0n` check added in hardening.
  it("FINDING S-01: empty string amount throws (input validation added)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer);

    const requirements = createBaseRequirements({ amount: "" });
    await expect(scheme.createPayment(requirements)).rejects.toThrow("payment amount must be positive");
  });

  // FINDING S-02 (FIXED): Negative amount string now throws early validation error.
  it("FINDING S-02: negative amount string throws (input validation added)", async () => {
    const signer = createMockSigner();
    const scheme = new ExactSuiClientScheme(signer);

    const requirements = createBaseRequirements({ amount: "-1000" });
    await expect(scheme.createPayment(requirements)).rejects.toThrow("payment amount must be positive");
  });
});

// ══════════════════════════════════════════════════════════════
// ExactSuiFacilitatorScheme — Robustness
// ══════════════════════════════════════════════════════════════

describe("ExactSuiFacilitatorScheme robustness", () => {
  it("rejects wrong scheme", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "stream" as any, payload: {} as any },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Expected exact scheme");
  });

  it("rejects missing transaction", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact", payload: { transaction: "", signature: "sig" } },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Missing transaction or signature");
  });

  it("rejects missing signature", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact", payload: { transaction: "tx", signature: "" } },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Missing transaction or signature");
  });

  it("rejects out-of-range protocolFeeBps (defense-in-depth)", async () => {
    const signer = createMockFacilitatorSigner();
    signer.verifySignature.mockResolvedValue(SENDER);
    signer.simulateTransaction.mockResolvedValue({
      effects: { status: { status: "success" } },
      balanceChanges: [{ owner: { AddressOwner: RECIPIENT }, coinType: "0x2::sui::SUI", amount: "1000000" }],
      events: [],
    });
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    // protocolFeeBps = 10001 (> 10000 = 100%)
    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact", payload: { transaction: "tx-data", signature: "sig-data" } },
      createBaseRequirements({ protocolFeeBps: 10001 }),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("protocolFeeBps out of range");
  });

  it("rejects negative protocolFeeBps", async () => {
    const signer = createMockFacilitatorSigner();
    signer.verifySignature.mockResolvedValue(SENDER);
    signer.simulateTransaction.mockResolvedValue({
      effects: { status: { status: "success" } },
      balanceChanges: [],
      events: [],
    });
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact", payload: { transaction: "tx-data", signature: "sig-data" } },
      createBaseRequirements({ protocolFeeBps: -1 }),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("protocolFeeBps out of range");
  });

  it("rejects non-integer protocolFeeBps", async () => {
    const signer = createMockFacilitatorSigner();
    signer.verifySignature.mockResolvedValue(SENDER);
    signer.simulateTransaction.mockResolvedValue({
      effects: { status: { status: "success" } },
      balanceChanges: [],
      events: [],
    });
    const scheme = new ExactSuiFacilitatorScheme(signer as any);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact", payload: { transaction: "tx-data", signature: "sig-data" } },
      createBaseRequirements({ protocolFeeBps: 0.5 }),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("protocolFeeBps out of range");
  });

  it("exports DEFAULT_MAX_SPONSOR_GAS_BUDGET as expected", () => {
    expect(DEFAULT_MAX_SPONSOR_GAS_BUDGET).toBe(10_000_000n);
  });
});

// ══════════════════════════════════════════════════════════════
// StreamSuiClientScheme — Missing requirements
// ══════════════════════════════════════════════════════════════

describe("StreamSuiClientScheme robustness", () => {
  it("throws when stream requirements missing", async () => {
    const signer = createMockSigner();
    const scheme = new StreamSuiClientScheme(signer, sweefiConfig);

    // No stream field in requirements
    const requirements = createBaseRequirements();
    await expect(scheme.createPayment(requirements)).rejects.toThrow("Stream requirements missing");
  });

  it("creates payment with valid stream requirements", async () => {
    const signer = createMockSigner();
    const scheme = new StreamSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      stream: {
        ratePerSecond: "100",
        budgetCap: "1000000",
        minDeposit: "50000",
      },
    } as any);

    const result = await scheme.createPayment(requirements);
    expect(result.scheme).toBe("stream");
  });
});

// ══════════════════════════════════════════════════════════════
// StreamSuiFacilitatorScheme — Constructor + verify robustness
// ══════════════════════════════════════════════════════════════

describe("StreamSuiFacilitatorScheme robustness", () => {
  it("throws on construction without packageId (anti-spoofing)", () => {
    const signer = createMockFacilitatorSigner();
    expect(() => new StreamSuiFacilitatorScheme(signer as any, "")).toThrow("packageId is required");
  });

  it("rejects wrong scheme", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new StreamSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact" as any, payload: {} as any },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Expected stream scheme");
  });

  it("rejects missing stream config in requirements", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new StreamSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "stream", payload: { transaction: "tx", signature: "sig" } },
      createBaseRequirements(), // no stream field
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Requirements missing stream config");
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowSuiClientScheme — Missing requirements
// ══════════════════════════════════════════════════════════════

describe("EscrowSuiClientScheme robustness", () => {
  it("throws when escrow requirements missing", async () => {
    const signer = createMockSigner();
    const scheme = new EscrowSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements();
    await expect(scheme.createPayment(requirements)).rejects.toThrow("Escrow requirements missing");
  });

  it("creates payment with valid escrow requirements", async () => {
    const signer = createMockSigner();
    const scheme = new EscrowSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      escrow: {
        seller: RECIPIENT,
        arbiter: SENDER,
        deadlineMs: String(Date.now() + 86_400_000),
      },
    } as any);

    const result = await scheme.createPayment(requirements);
    expect(result.scheme).toBe("escrow");
  });

  // FINDING S-03 (fixed): Arbiter must be distinct from seller.
  // The Move contract rejects arbiter == seller (EArbiterIsSeller).
  // SDK now throws early instead of silently defaulting to seller.
  it("throws when arbiter is not specified", async () => {
    const signer = createMockSigner();
    const scheme = new EscrowSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      escrow: {
        seller: RECIPIENT,
        // arbiter intentionally omitted — Move rejects arbiter == seller
        deadlineMs: String(Date.now() + 86_400_000),
      },
    } as any);

    await expect(scheme.createPayment(requirements)).rejects.toThrow(
      "Escrow requires an arbiter distinct from the seller",
    );
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowSuiFacilitatorScheme — Constructor + verify robustness
// ══════════════════════════════════════════════════════════════

describe("EscrowSuiFacilitatorScheme robustness", () => {
  it("throws on construction without packageId (anti-spoofing)", () => {
    const signer = createMockFacilitatorSigner();
    expect(() => new EscrowSuiFacilitatorScheme(signer as any, "")).toThrow("packageId is required");
  });

  it("rejects wrong scheme", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new EscrowSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact" as any, payload: {} as any },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Expected escrow scheme");
  });

  it("rejects missing escrow config in requirements", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new EscrowSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "escrow", payload: { transaction: "tx", signature: "sig" } },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Requirements missing escrow config");
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidSuiClientScheme — Robustness
// ══════════════════════════════════════════════════════════════

describe("PrepaidSuiClientScheme robustness", () => {
  it("throws when prepaid requirements missing", async () => {
    const signer = createMockSigner();
    const scheme = new PrepaidSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements();
    await expect(scheme.createPayment(requirements)).rejects.toThrow("Prepaid requirements missing");
  });

  it("throws when providerPubkey present but disputeWindowMs missing", async () => {
    const signer = createMockSigner();
    const scheme = new PrepaidSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
        providerPubkey: "ab".repeat(32),
        // disputeWindowMs intentionally omitted
      },
    } as any);

    await expect(scheme.createPayment(requirements)).rejects.toThrow("providerPubkey requires disputeWindowMs");
  });

  it("throws when disputeWindowMs present but providerPubkey missing", async () => {
    const signer = createMockSigner();
    const scheme = new PrepaidSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
        disputeWindowMs: "300000",
        // providerPubkey intentionally omitted
      },
    } as any);

    await expect(scheme.createPayment(requirements)).rejects.toThrow("disputeWindowMs requires providerPubkey");
  });

  it("throws when withdrawalDelayMs < disputeWindowMs (v0.2)", async () => {
    const signer = createMockSigner();
    const scheme = new PrepaidSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "60000", // 1 min
        providerPubkey: "ab".repeat(32),
        disputeWindowMs: "300000", // 5 min > 1 min
      },
    } as any);

    await expect(scheme.createPayment(requirements)).rejects.toThrow("withdrawalDelayMs");
  });

  it("creates v0.1 payment (no receipts) with valid requirements", async () => {
    const signer = createMockSigner();
    const scheme = new PrepaidSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
      },
    } as any);

    const result = await scheme.createPayment(requirements);
    expect(result.scheme).toBe("prepaid");
    expect(result.payload.ratePerCall).toBe("1000");
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidSuiFacilitatorScheme — Constructor + verify robustness
// ══════════════════════════════════════════════════════════════

describe("PrepaidSuiFacilitatorScheme robustness", () => {
  it("throws on construction without packageId (anti-spoofing)", () => {
    const signer = createMockFacilitatorSigner();
    expect(() => new PrepaidSuiFacilitatorScheme(signer as any, "")).toThrow("packageId is required");
  });

  it("rejects wrong scheme", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new PrepaidSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "exact" as any, payload: {} as any },
      createBaseRequirements(),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Expected prepaid scheme");
  });

  it("rejects missing prepaid config", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new PrepaidSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      { s402Version: "1", scheme: "prepaid", payload: { transaction: "tx", signature: "sig", ratePerCall: "1000" } },
      createBaseRequirements(), // no prepaid field
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toBe("Requirements missing prepaid config");
  });

  it("rejects rate mismatch between payload and requirements", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new PrepaidSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      {
        s402Version: "1",
        scheme: "prepaid",
        payload: { transaction: "tx", signature: "sig", ratePerCall: "2000" },
      },
      createBaseRequirements({
        prepaid: { ratePerCall: "1000", minDeposit: "50000", withdrawalDelayMs: "1800000" },
      } as any),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("Rate mismatch");
  });

  it("rejects maxCalls mismatch", async () => {
    const signer = createMockFacilitatorSigner();
    const scheme = new PrepaidSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      {
        s402Version: "1",
        scheme: "prepaid",
        payload: { transaction: "tx", signature: "sig", ratePerCall: "1000", maxCalls: "50" },
      },
      createBaseRequirements({
        prepaid: { ratePerCall: "1000", maxCalls: "100", minDeposit: "50000", withdrawalDelayMs: "1800000" },
      } as any),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("MaxCalls mismatch");
  });

  // FINDING S-04: providerPubkey format validation in facilitator only checks length
  // after stripping 0x prefix, but does NOT verify hex characters. The regex check
  // is /^[0-9a-fA-F]{64}$/ which does cover both — this is actually correct.
  it("rejects invalid providerPubkey format (wrong length)", async () => {
    const signer = createMockFacilitatorSigner();
    signer.verifySignature.mockResolvedValue(SENDER);
    signer.simulateTransaction.mockResolvedValue({
      effects: { status: { status: "success" } },
      events: [{
        type: `${PACKAGE_ID}::prepaid::PrepaidDeposited`,
        parsedJson: {
          balance_id: "0x1",
          agent: SENDER,
          provider: RECIPIENT,
          amount: "1000000",
          rate_per_call: "1000",
          max_calls: "100",
          fee_micro_pct: "0",
          token_type: "0x2::sui::SUI",
          timestamp_ms: "0",
        },
      }],
    });
    const scheme = new PrepaidSuiFacilitatorScheme(signer as any, PACKAGE_ID);

    const result = await scheme.verify(
      {
        s402Version: "1",
        scheme: "prepaid",
        payload: { transaction: "tx-data", signature: "sig-data", ratePerCall: "1000" },
      },
      createBaseRequirements({
        prepaid: {
          ratePerCall: "1000",
          minDeposit: "50000",
          withdrawalDelayMs: "1800000",
          providerPubkey: "0xabcd", // too short — only 2 bytes after 0x
        },
      } as any),
    );

    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("Invalid providerPubkey format");
  });
});

// ══════════════════════════════════════════════════════════════
// UnlockSuiClientScheme — Missing requirements
// ══════════════════════════════════════════════════════════════

describe("UnlockSuiClientScheme robustness", () => {
  it("throws when unlock requirements missing", async () => {
    const signer = createMockSigner();
    const scheme = new UnlockSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements();
    await expect(scheme.createPayment(requirements)).rejects.toThrow("Unlock requirements missing");
  });

  it("throws when arbiter is not specified (no escrow sub-config)", async () => {
    const signer = createMockSigner();
    const scheme = new UnlockSuiClientScheme(signer, sweefiConfig);

    const requirements = createBaseRequirements({
      unlock: { encryptionId: "enc-123" },
    } as any);

    // Without escrow.arbiter, should throw — Move rejects arbiter == seller
    await expect(scheme.createPayment(requirements)).rejects.toThrow(
      "Unlock requires an arbiter distinct from the seller",
    );
  });
});

// ══════════════════════════════════════════════════════════════
// Server Schemes — buildRequirements robustness
// ══════════════════════════════════════════════════════════════

describe("StreamSuiServerScheme robustness", () => {
  it("throws when stream config missing from route", () => {
    const scheme = new StreamSuiServerScheme();

    expect(() => scheme.buildRequirements({
      schemes: ["stream"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
    } as s402RouteConfig)).toThrow("Stream config required");
  });

  it("defaults asset to SUI when not specified", () => {
    const scheme = new StreamSuiServerScheme();

    const requirements = scheme.buildRequirements({
      schemes: ["stream"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      stream: {
        ratePerSecond: "100",
        budgetCap: "1000000",
        minDeposit: "50000",
      },
    } as s402RouteConfig);

    expect(requirements.asset).toBe("0x2::sui::SUI");
  });

  it("always includes exact in accepts (fallback scheme)", () => {
    const scheme = new StreamSuiServerScheme();

    const requirements = scheme.buildRequirements({
      schemes: ["stream"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      stream: {
        ratePerSecond: "100",
        budgetCap: "1000000",
        minDeposit: "50000",
      },
    } as s402RouteConfig);

    expect(requirements.accepts).toContain("exact");
    expect(requirements.accepts).toContain("stream");
  });
});

describe("EscrowSuiServerScheme robustness", () => {
  it("throws when escrow config missing from route", () => {
    const scheme = new EscrowSuiServerScheme();

    expect(() => scheme.buildRequirements({
      schemes: ["escrow"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
    } as s402RouteConfig)).toThrow("Escrow config required");
  });

  it("defaults seller to payTo when not specified", () => {
    const scheme = new EscrowSuiServerScheme();

    const requirements = scheme.buildRequirements({
      schemes: ["escrow"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      escrow: {
        // seller intentionally omitted
        deadlineMs: String(Date.now() + 86_400_000),
      },
    } as s402RouteConfig);

    expect(requirements.escrow?.seller).toBe(RECIPIENT);
  });
});

describe("PrepaidSuiServerScheme robustness", () => {
  it("throws when prepaid config missing from route", () => {
    const scheme = new PrepaidSuiServerScheme();

    expect(() => scheme.buildRequirements({
      schemes: ["prepaid"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
    } as s402RouteConfig)).toThrow("Prepaid route config requires prepaid section");
  });

  it("always includes exact in accepts", () => {
    const scheme = new PrepaidSuiServerScheme();

    const requirements = scheme.buildRequirements({
      schemes: ["prepaid"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
      },
    } as s402RouteConfig);

    expect(requirements.accepts).toContain("exact");
    expect(requirements.accepts).toContain("prepaid");
  });

  it("includes v0.2 fields when receiptConfig provided", () => {
    const scheme = new PrepaidSuiServerScheme({
      providerPubkey: "ab".repeat(32),
      disputeWindowMs: "300000",
    });

    const requirements = scheme.buildRequirements({
      schemes: ["prepaid"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
      },
    } as s402RouteConfig);

    expect(requirements.prepaid?.providerPubkey).toBe("ab".repeat(32));
    expect(requirements.prepaid?.disputeWindowMs).toBe("300000");
  });

  it("omits v0.2 fields when no receiptConfig", () => {
    const scheme = new PrepaidSuiServerScheme(); // no receiptConfig

    const requirements = scheme.buildRequirements({
      schemes: ["prepaid"],
      network: "sui:testnet",
      payTo: RECIPIENT,
      price: "1000000",
      prepaid: {
        ratePerCall: "1000",
        minDeposit: "50000",
        withdrawalDelayMs: "1800000",
      },
    } as s402RouteConfig);

    expect(requirements.prepaid?.providerPubkey).toBeUndefined();
    expect(requirements.prepaid?.disputeWindowMs).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════
// DirectSuiSettlement — receiptRequired guard
// ══════════════════════════════════════════════════════════════

describe("DirectSuiSettlement robustness", () => {
  it("rejects when receiptRequired is true", async () => {
    const mockKeypair = {
      toSuiAddress: () => SENDER,
      signTransaction: vi.fn(),
    };
    const mockClient = {} as any;

    const settlement = new DirectSuiSettlement(mockKeypair as any, mockClient);

    const result = await settlement.settleDirectly(
      createBaseRequirements({ receiptRequired: true } as any),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not support on-chain receipts");
  });
});

// ══════════════════════════════════════════════════════════════
// Cross-scheme: scheme field consistency
// ══════════════════════════════════════════════════════════════

describe("scheme field consistency", () => {
  it("ExactSuiClientScheme.scheme === 'exact'", () => {
    const scheme = new ExactSuiClientScheme(createMockSigner());
    expect(scheme.scheme).toBe("exact");
  });

  it("StreamSuiClientScheme.scheme === 'stream'", () => {
    const scheme = new StreamSuiClientScheme(createMockSigner(), sweefiConfig);
    expect(scheme.scheme).toBe("stream");
  });

  it("EscrowSuiClientScheme.scheme === 'escrow'", () => {
    const scheme = new EscrowSuiClientScheme(createMockSigner(), sweefiConfig);
    expect(scheme.scheme).toBe("escrow");
  });

  it("PrepaidSuiClientScheme.scheme === 'prepaid'", () => {
    const scheme = new PrepaidSuiClientScheme(createMockSigner(), sweefiConfig);
    expect(scheme.scheme).toBe("prepaid");
  });

  it("UnlockSuiClientScheme.scheme === 'unlock'", () => {
    const scheme = new UnlockSuiClientScheme(createMockSigner(), sweefiConfig);
    expect(scheme.scheme).toBe("unlock");
  });
});
