/**
 * PTB Builder Input Validation Audit Tests
 *
 * Tests that every PTB builder properly validates inputs BEFORE constructing
 * a Transaction. Catches validation gaps where invalid data would silently
 * pass to the Move VM and fail with cryptic on-chain errors.
 *
 * Security findings are documented inline with severity ratings.
 */

import { describe, it, expect } from "vitest";
import {
  buildPayTx,
  buildPayComposableTx,
  buildCreateInvoiceTx,
  buildPayInvoiceTx,
  buildCreateStreamTx,
  buildCreateStreamWithTimeoutTx,
  buildClaimTx,
  buildBatchClaimTx,
  buildPauseTx,
  buildResumeTx,
  buildCloseTx,
  buildRecipientCloseTx,
  buildTopUpTx,
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
  buildPayAndProveTx,
  buildAdminPauseTx,
  buildAdminUnpauseTx,
  buildBurnAdminCapTx,
  buildAutoUnpauseTx,
} from "../../src/ptb";
import {
  buildCreateMandateTx,
  buildMandatedPayTx,
  buildCreateRegistryTx,
  buildRevokeMandateTx,
} from "../../src/ptb/mandate";
import {
  buildCreateAgentMandateTx,
  buildAgentMandatedPayTx,
  buildUpgradeMandateLevelTx,
  buildUpdateMandateCapsTx,
  MandateLevel,
} from "../../src/ptb/agent-mandate";
import {
  buildDepositTx,
  buildClaimTx as buildPrepaidClaimTx,
  buildRequestWithdrawalTx,
  buildFinalizeWithdrawalTx,
  buildCancelWithdrawalTx,
  buildAgentCloseTx,
  buildProviderCloseTx,
  buildTopUpTx as buildPrepaidTopUpTx,
  buildDepositWithReceiptsTx,
  buildFinalizeClaimTx,
  buildDisputeClaimTx,
  buildWithdrawDisputedTx,
} from "../../src/ptb/prepaid";
import { assertFeeMicroPercent, assertPositive } from "../../src/ptb/assert";
import type { SweefiConfig } from "../../src/ptb";

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const PACKAGE_ID = "0x" + "ab".repeat(32);
const SENDER = "0x" + "11".repeat(32);
const RECIPIENT = "0x" + "22".repeat(32);
const FEE_RECIPIENT = "0x" + "33".repeat(32);
const METER_ID = "0x" + "44".repeat(32);
const ESCROW_ID = "0x" + "66".repeat(32);
const ARBITER = "0x" + "77".repeat(32);
const ADMIN_CAP_ID = "0x" + "88".repeat(32);
const PROTOCOL_STATE_ID = "0x" + "99".repeat(32);
const BALANCE_ID = "0x" + "aa".repeat(32);
const MANDATE_ID = "0x" + "bb".repeat(32);
const REGISTRY_ID = "0x" + "cc".repeat(32);
const SUI_COIN_TYPE = "0x2::sui::SUI";

const config: SweefiConfig = { packageId: PACKAGE_ID };
const fullConfig: SweefiConfig = { packageId: PACKAGE_ID, protocolStateId: PROTOCOL_STATE_ID };

// u64::MAX = 18446744073709551615
const U64_MAX = 18446744073709551615n;
const U64_MAX_PLUS_1 = 18446744073709551616n;

// ══════════════════════════════════════════════════════════════
// Shared assertion functions (assert.ts)
// ══════════════════════════════════════════════════════════════

describe("assertFeeMicroPercent", () => {
  it("accepts 0 (no fee)", () => {
    expect(() => assertFeeMicroPercent(0, "test")).not.toThrow();
  });

  it("accepts 1_000_000 (100%)", () => {
    expect(() => assertFeeMicroPercent(1_000_000, "test")).not.toThrow();
  });

  it("accepts typical fee (5_000 = 0.5%)", () => {
    expect(() => assertFeeMicroPercent(5_000, "test")).not.toThrow();
  });

  it("rejects -1", () => {
    expect(() => assertFeeMicroPercent(-1, "test")).toThrow("feeMicroPercent");
  });

  it("rejects 1_000_001 (over 100%)", () => {
    expect(() => assertFeeMicroPercent(1_000_001, "test")).toThrow("feeMicroPercent");
  });

  it("rejects NaN", () => {
    expect(() => assertFeeMicroPercent(NaN, "test")).toThrow("feeMicroPercent");
  });

  it("rejects Infinity", () => {
    expect(() => assertFeeMicroPercent(Infinity, "test")).toThrow("feeMicroPercent");
  });

  it("rejects -Infinity", () => {
    expect(() => assertFeeMicroPercent(-Infinity, "test")).toThrow("feeMicroPercent");
  });

  it("rejects fractional value (0.5)", () => {
    expect(() => assertFeeMicroPercent(0.5, "test")).toThrow("feeMicroPercent");
  });

  it("rejects MAX_SAFE_INTEGER + 1 (not integer-safe)", () => {
    // Number.MAX_SAFE_INTEGER + 1 === 9007199254740992 which is > 1_000_000
    // so it will fail the range check, not the integer check
    expect(() => assertFeeMicroPercent(Number.MAX_SAFE_INTEGER + 1, "test")).toThrow("feeMicroPercent");
  });
});

describe("assertPositive", () => {
  it("accepts 1n", () => {
    expect(() => assertPositive(1n, "amount", "test")).not.toThrow();
  });

  it("accepts u64::MAX", () => {
    expect(() => assertPositive(U64_MAX, "amount", "test")).not.toThrow();
  });

  it("rejects 0n", () => {
    expect(() => assertPositive(0n, "amount", "test")).toThrow("must be > 0");
  });

  it("rejects -1n", () => {
    expect(() => assertPositive(-1n, "amount", "test")).toThrow("must be > 0");
  });
});

// ══════════════════════════════════════════════════════════════
// Payment builders — amount + fee validation
// ══════════════════════════════════════════════════════════════

describe("buildPayTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
  };

  it("rejects amount = 0n", () => {
    expect(() => buildPayTx(config, { ...validParams, amount: 0n })).toThrow("must be > 0");
  });

  it("rejects negative amount", () => {
    expect(() => buildPayTx(config, { ...validParams, amount: -1n })).toThrow("must be > 0");
  });

  it("accepts u64::MAX amount (upper bound is on-chain concern)", () => {
    // NOTE: The SDK does NOT validate u64::MAX overflow. This is an on-chain
    // concern — coinWithBalance would fail if the user doesn't have that much.
    // Documenting this as ACCEPTABLE — the Move VM enforces the actual bounds.
    expect(() => buildPayTx(config, { ...validParams, amount: U64_MAX })).not.toThrow();
  });

  it("rejects feeMicroPercent = -1", () => {
    expect(() => buildPayTx(config, { ...validParams, amount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });

  it("rejects feeMicroPercent = 1_000_001", () => {
    expect(() => buildPayTx(config, { ...validParams, amount: 100n, feeMicroPercent: 1_000_001 })).toThrow("feeMicroPercent");
  });

  it("rejects feeMicroPercent = NaN", () => {
    expect(() => buildPayTx(config, { ...validParams, amount: 100n, feeMicroPercent: NaN })).toThrow("feeMicroPercent");
  });
});

describe("buildPayComposableTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
  };

  it("rejects amount = 0n", () => {
    expect(() => buildPayComposableTx(config, { ...validParams, amount: 0n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = -1", () => {
    expect(() => buildPayComposableTx(config, { ...validParams, amount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });
});

describe("buildCreateInvoiceTx validation", () => {
  const validParams = {
    sender: SENDER,
    recipient: RECIPIENT,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
  };

  it("rejects expectedAmount = 0n", () => {
    expect(() => buildCreateInvoiceTx(config, { ...validParams, expectedAmount: 0n })).toThrow("must be > 0");
  });

  it("rejects negative expectedAmount", () => {
    expect(() => buildCreateInvoiceTx(config, { ...validParams, expectedAmount: -100n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = 1_000_001", () => {
    expect(() => buildCreateInvoiceTx(config, { ...validParams, expectedAmount: 100n, feeMicroPercent: 1_000_001 })).toThrow("feeMicroPercent");
  });
});

describe("buildPayAndProveTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
    receiptDestination: SENDER,
  };

  it("rejects amount = 0n", () => {
    expect(() => buildPayAndProveTx(config, { ...validParams, amount: 0n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = -1", () => {
    expect(() => buildPayAndProveTx(config, { ...validParams, amount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });
});

// ══════════════════════════════════════════════════════════════
// FINDING F-01: buildPayInvoiceTx — NO amount validation
// Severity: LOW
// The builder does not call assertPositive on params.amount.
// However, the amount is primarily used for coin selection
// (coinWithBalance), and the Move contract enforces the invoice's
// expected_amount. Still, 0n could produce a confusing on-chain error.
// ══════════════════════════════════════════════════════════════

describe("buildPayInvoiceTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    invoiceId: "0x" + "55".repeat(32),
  };

  it("FIXED F-01: validates amount = 0n (assertPositive added)", () => {
    expect(() => buildPayInvoiceTx(config, { ...validParams, amount: 0n })).toThrow(/must be > 0/);
  });

  it("FIXED F-01: validates negative amount", () => {
    expect(() => buildPayInvoiceTx(config, { ...validParams, amount: -1n })).toThrow(/must be > 0/);
  });
});

// ══════════════════════════════════════════════════════════════
// Stream builders — amount + rate + fee validation
// ══════════════════════════════════════════════════════════════

describe("buildCreateStreamTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
    ratePerSecond: 100n,
    budgetCap: 1_000_000n,
  };

  it("rejects depositAmount = 0n", () => {
    expect(() => buildCreateStreamTx(fullConfig, { ...validParams, depositAmount: 0n })).toThrow("must be > 0");
  });

  it("rejects ratePerSecond = 0n", () => {
    expect(() => buildCreateStreamTx(fullConfig, { ...validParams, depositAmount: 100n, ratePerSecond: 0n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = -1", () => {
    expect(() => buildCreateStreamTx(fullConfig, { ...validParams, depositAmount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });

  // FINDING F-02: budgetCap is NOT validated with assertPositive
  it("FINDING F-02: does NOT validate budgetCap = 0n (missing assertPositive)", () => {
    // budgetCap = 0 would create a useless stream with no budget. On-chain it
    // may succeed but the stream would be immediately exhausted.
    expect(() => buildCreateStreamTx(fullConfig, { ...validParams, depositAmount: 100n, budgetCap: 0n })).not.toThrow();
  });
});

describe("buildCreateStreamWithTimeoutTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    depositAmount: 100_000n,
    ratePerSecond: 100n,
    budgetCap: 1_000_000n,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
    recipientCloseTimeoutMs: 172_800_000n,
  };

  it("rejects depositAmount = 0n", () => {
    expect(() => buildCreateStreamWithTimeoutTx(fullConfig, { ...validParams, depositAmount: 0n })).toThrow("must be > 0");
  });

  it("rejects ratePerSecond = 0n", () => {
    expect(() => buildCreateStreamWithTimeoutTx(fullConfig, { ...validParams, ratePerSecond: 0n })).toThrow("must be > 0");
  });

  // FINDING F-03: recipientCloseTimeoutMs is NOT validated for minimum (86_400_000)
  // Move contract enforces >= 1 day, but SDK passes 0 silently.
  it("FINDING F-03: does NOT validate recipientCloseTimeoutMs = 0n (missing min check)", () => {
    expect(() => buildCreateStreamWithTimeoutTx(fullConfig, { ...validParams, recipientCloseTimeoutMs: 0n })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// Stream top-up — FINDING F-04: no amount validation
// ══════════════════════════════════════════════════════════════

describe("buildTopUpTx (stream) validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    meterId: METER_ID,
    sender: SENDER,
  };

  it("FIXED F-04: validates depositAmount = 0n (assertPositive added)", () => {
    expect(() => buildTopUpTx(fullConfig, { ...validParams, depositAmount: 0n })).toThrow(/must be > 0/);
  });

  it("FIXED F-04: validates negative depositAmount", () => {
    expect(() => buildTopUpTx(fullConfig, { ...validParams, depositAmount: -1n })).toThrow(/must be > 0/);
  });
});

// ══════════════════════════════════════════════════════════════
// Batch claim — has validation
// ══════════════════════════════════════════════════════════════

describe("buildBatchClaimTx validation", () => {
  it("rejects empty meterIds", () => {
    expect(() => buildBatchClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterIds: [],
      sender: RECIPIENT,
    })).toThrow("meterIds must not be empty");
  });

  it("rejects > 512 meterIds", () => {
    const meterIds = Array.from({ length: 513 }, (_, i) => "0x" + i.toString(16).padStart(64, "0"));
    expect(() => buildBatchClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterIds,
      sender: RECIPIENT,
    })).toThrow("max 512");
  });
});

// ══════════════════════════════════════════════════════════════
// Escrow builders — deposit + fee validation
// ══════════════════════════════════════════════════════════════

describe("buildCreateEscrowTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    seller: RECIPIENT,
    arbiter: ARBITER,
    deadlineMs: BigInt(Date.now() + 86_400_000),
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
  };

  it("rejects depositAmount = 0n", () => {
    expect(() => buildCreateEscrowTx(fullConfig, { ...validParams, depositAmount: 0n })).toThrow("must be > 0");
  });

  it("rejects negative depositAmount", () => {
    expect(() => buildCreateEscrowTx(fullConfig, { ...validParams, depositAmount: -1n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = 1_000_001", () => {
    expect(() => buildCreateEscrowTx(fullConfig, { ...validParams, depositAmount: 100n, feeMicroPercent: 1_000_001 })).toThrow("feeMicroPercent");
  });

  // FINDING F-05: deadlineMs is NOT validated (could be in the past)
  it("FINDING F-05: does NOT validate deadlineMs = 0n (past deadline)", () => {
    // A deadline of 0 means the escrow is already past deadline at creation.
    // The Move contract would allow creation but auto-refund becomes immediately possible.
    expect(() => buildCreateEscrowTx(fullConfig, { ...validParams, depositAmount: 100n, deadlineMs: 0n })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// Prepaid builders — amount + rate + fee validation
// ══════════════════════════════════════════════════════════════

describe("buildDepositTx (prepaid) validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    provider: RECIPIENT,
    ratePerCall: 1000n,
    maxCalls: 100n,
    withdrawalDelayMs: 1_800_000n,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
  };

  it("rejects amount = 0n", () => {
    expect(() => buildDepositTx(fullConfig, { ...validParams, amount: 0n })).toThrow("must be > 0");
  });

  it("rejects ratePerCall = 0n", () => {
    expect(() => buildDepositTx(fullConfig, { ...validParams, amount: 100n, ratePerCall: 0n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = NaN", () => {
    expect(() => buildDepositTx(fullConfig, { ...validParams, amount: 100n, feeMicroPercent: NaN })).toThrow("feeMicroPercent");
  });

  // FINDING F-06: withdrawalDelayMs is NOT validated for minimum
  // Move contract enforces minimum of 60 seconds (60_000ms).
  it("FINDING F-06: does NOT validate withdrawalDelayMs = 0n (below Move minimum)", () => {
    expect(() => buildDepositTx(fullConfig, { ...validParams, amount: 100n, withdrawalDelayMs: 0n })).not.toThrow();
  });
});

describe("buildDepositWithReceiptsTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    provider: RECIPIENT,
    amount: 1_000_000n,
    ratePerCall: 1000n,
    maxCalls: 100n,
    withdrawalDelayMs: 1_800_000n,
    feeMicroPercent: 5_000,
    feeRecipient: FEE_RECIPIENT,
    providerPubkey: "ab".repeat(32),
    disputeWindowMs: 300_000n,
  };

  it("rejects amount = 0n", () => {
    expect(() => buildDepositWithReceiptsTx(fullConfig, { ...validParams, amount: 0n })).toThrow("must be > 0");
  });

  it("rejects ratePerCall = 0n", () => {
    expect(() => buildDepositWithReceiptsTx(fullConfig, { ...validParams, ratePerCall: 0n })).toThrow("must be > 0");
  });

  it("rejects feeMicroPercent = 1_000_001", () => {
    expect(() => buildDepositWithReceiptsTx(fullConfig, { ...validParams, feeMicroPercent: 1_000_001 })).toThrow("feeMicroPercent");
  });

  it("rejects odd-length providerPubkey hex", () => {
    expect(() => buildDepositWithReceiptsTx(fullConfig, { ...validParams, providerPubkey: "abc" })).toThrow("odd length");
  });

  it("rejects non-hex providerPubkey", () => {
    expect(() => buildDepositWithReceiptsTx(fullConfig, { ...validParams, providerPubkey: "ZZZZ" })).toThrow("non-hex");
  });
});

// ══════════════════════════════════════════════════════════════
// Prepaid top-up — FINDING F-07: no amount validation
// ══════════════════════════════════════════════════════════════

describe("buildPrepaidTopUpTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    balanceId: BALANCE_ID,
    sender: SENDER,
  };

  it("FIXED F-07: validates amount = 0n (assertPositive added)", () => {
    expect(() => buildPrepaidTopUpTx(fullConfig, { ...validParams, amount: 0n })).toThrow(/must be > 0/);
  });

  it("FIXED F-07: validates negative amount", () => {
    expect(() => buildPrepaidTopUpTx(fullConfig, { ...validParams, amount: -1n })).toThrow(/must be > 0/);
  });
});

// ══════════════════════════════════════════════════════════════
// Mandate builders — FINDING F-08: missing amount validation
// ══════════════════════════════════════════════════════════════

describe("buildMandatedPayTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeRecipient: FEE_RECIPIENT,
    mandateId: MANDATE_ID,
    registryId: REGISTRY_ID,
  };

  it("validates feeMicroPercent", () => {
    expect(() => buildMandatedPayTx(config, { ...validParams, amount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });

  // FIXED F-08: buildMandatedPayTx now calls assertPositive on amount
  it("FIXED F-08: validates amount = 0n (assertPositive added)", () => {
    expect(() => buildMandatedPayTx(config, { ...validParams, amount: 0n, feeMicroPercent: 5_000 })).toThrow(/must be > 0/);
  });
});

describe("buildAgentMandatedPayTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    recipient: RECIPIENT,
    feeRecipient: FEE_RECIPIENT,
    mandateId: MANDATE_ID,
    registryId: REGISTRY_ID,
  };

  it("validates feeMicroPercent", () => {
    expect(() => buildAgentMandatedPayTx(config, { ...validParams, amount: 100n, feeMicroPercent: -1 })).toThrow("feeMicroPercent");
  });

  // FIXED F-09: buildAgentMandatedPayTx now calls assertPositive on amount
  it("FIXED F-09: validates amount = 0n (assertPositive added)", () => {
    expect(() => buildAgentMandatedPayTx(config, { ...validParams, amount: 0n, feeMicroPercent: 5_000 })).toThrow(/must be > 0/);
  });
});

// ══════════════════════════════════════════════════════════════
// Mandate creation — FINDING F-10: no cap/limit validation
// ══════════════════════════════════════════════════════════════

describe("buildCreateMandateTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    delegate: RECIPIENT,
    expiresAtMs: null as bigint | null,
  };

  // FINDING F-10: buildCreateMandateTx does NOT validate maxPerTx or maxTotal
  // A mandate with maxPerTx=0 or maxTotal=0 would be useless (no spending possible)
  // but is not caught client-side.
  it("FINDING F-10: does NOT validate maxPerTx = 0n", () => {
    expect(() => buildCreateMandateTx(config, { ...validParams, maxPerTx: 0n, maxTotal: 100n })).not.toThrow();
  });

  it("FINDING F-10: does NOT validate maxTotal = 0n", () => {
    expect(() => buildCreateMandateTx(config, { ...validParams, maxPerTx: 100n, maxTotal: 0n })).not.toThrow();
  });

  // No fee validation here — mandate creation doesn't take a fee param (correct)
});

describe("buildCreateAgentMandateTx validation", () => {
  const validParams = {
    coinType: SUI_COIN_TYPE,
    sender: SENDER,
    delegate: RECIPIENT,
    level: MandateLevel.CAPPED as 0 | 1 | 2 | 3,
    maxPerTx: 1000n,
    dailyLimit: 5000n,
    weeklyLimit: 20000n,
    maxTotal: 100000n,
    expiresAtMs: null as bigint | null,
  };

  // Good: validates L2+ with maxTotal=0
  it("rejects L2+ mandate with maxTotal = 0n (v8 audit F-14)", () => {
    expect(() => buildCreateAgentMandateTx(config, { ...validParams, maxTotal: 0n })).toThrow("zero lifetime budget");
  });

  // But L0/L1 with maxTotal=0 is allowed (no spending at those levels)
  it("allows L0 with maxTotal = 0n", () => {
    expect(() => buildCreateAgentMandateTx(config, { ...validParams, level: MandateLevel.READ_ONLY, maxTotal: 0n })).not.toThrow();
  });

  it("allows L1 with maxTotal = 0n", () => {
    expect(() => buildCreateAgentMandateTx(config, { ...validParams, level: MandateLevel.MONITOR, maxTotal: 0n })).not.toThrow();
  });

  // FINDING F-11: No fee validation on createAgentMandate (correct — no fee param)
  // FINDING F-12: maxPerTx is NOT validated — could be 0 even at L2+
  it("FINDING F-12: does NOT validate maxPerTx = 0n at L2+ (zero per-tx cap)", () => {
    expect(() => buildCreateAgentMandateTx(config, { ...validParams, maxPerTx: 0n })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// Summary coverage: builders that DO validate vs DO NOT
// ══════════════════════════════════════════════════════════════

describe("validation coverage summary", () => {
  // These builders properly validate amount AND fee:
  it("buildPayTx validates amount + fee", () => {
    expect(() => buildPayTx(config, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, amount: 0n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
    expect(() => buildPayTx(config, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, amount: 100n, feeMicroPercent: -1, feeRecipient: FEE_RECIPIENT })).toThrow();
  });

  it("buildPayComposableTx validates amount + fee", () => {
    expect(() => buildPayComposableTx(config, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, amount: 0n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
  });

  it("buildCreateInvoiceTx validates amount + fee", () => {
    expect(() => buildCreateInvoiceTx(config, { sender: SENDER, recipient: RECIPIENT, expectedAmount: 0n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
  });

  it("buildPayAndProveTx validates amount + fee", () => {
    expect(() => buildPayAndProveTx(config, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, amount: 0n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT, receiptDestination: SENDER })).toThrow();
  });

  it("buildCreateStreamTx validates deposit + rate + fee", () => {
    expect(() => buildCreateStreamTx(fullConfig, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, depositAmount: 0n, ratePerSecond: 100n, budgetCap: 1000n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
    expect(() => buildCreateStreamTx(fullConfig, { coinType: SUI_COIN_TYPE, sender: SENDER, recipient: RECIPIENT, depositAmount: 100n, ratePerSecond: 0n, budgetCap: 1000n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
  });

  it("buildCreateEscrowTx validates deposit + fee", () => {
    expect(() => buildCreateEscrowTx(fullConfig, { coinType: SUI_COIN_TYPE, sender: SENDER, seller: RECIPIENT, arbiter: ARBITER, depositAmount: 0n, deadlineMs: 999n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
  });

  it("buildDepositTx (prepaid) validates amount + rate + fee", () => {
    expect(() => buildDepositTx(fullConfig, { coinType: SUI_COIN_TYPE, sender: SENDER, provider: RECIPIENT, amount: 0n, ratePerCall: 1000n, withdrawalDelayMs: 1800000n, feeMicroPercent: 5_000, feeRecipient: FEE_RECIPIENT })).toThrow();
  });
});
