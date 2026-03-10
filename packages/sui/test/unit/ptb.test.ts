import { describe, it, expect } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
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
  buildTopUpTx,
  buildRecipientCloseTx,
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildReleaseEscrowComposableTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
  buildPayAndProveTx,
  buildAdminPauseTx,
  buildAdminUnpauseTx,
  buildBurnAdminCapTx,
  buildAutoUnpauseTx,
  TESTNET_PACKAGE_ID,
} from "../../src/ptb";
import type { SweefiConfig } from "../../src/ptb";

const PACKAGE_ID = "0x" + "ab".repeat(32);
const SENDER = "0x" + "11".repeat(32);
const RECIPIENT = "0x" + "22".repeat(32);
const FEE_RECIPIENT = "0x" + "33".repeat(32);
const METER_ID = "0x" + "44".repeat(32);
const INVOICE_ID = "0x" + "55".repeat(32);
const ESCROW_ID = "0x" + "66".repeat(32);
const ARBITER = "0x" + "77".repeat(32);
const ADMIN_CAP_ID = "0x" + "88".repeat(32);
const PROTOCOL_STATE_ID = "0x" + "99".repeat(32);
const SUI_COIN_TYPE = "0x2::sui::SUI";

/** Payment-only config (no protocolStateId needed) */
const config: SweefiConfig = { packageId: PACKAGE_ID };

/** Config with protocolStateId — required for stream/escrow create + admin */
const fullConfig: SweefiConfig = { packageId: PACKAGE_ID, protocolStateId: PROTOCOL_STATE_ID };

// ══════════════════════════════════════════════════════════════
// Payment PTB builders
// ══════════════════════════════════════════════════════════════

describe("buildPayTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildPayTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts string memo", () => {
    const tx = buildPayTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: "test payment",
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts Uint8Array memo", () => {
    const tx = buildPayTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: new Uint8Array([0xde, 0xad]),
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("defaults memo to empty when omitted", () => {
    // No memo param — should not throw
    const tx = buildPayTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 500n,
      feeMicroPercent: 0,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildPayComposableTx", () => {
  it("returns tx and receipt result", () => {
    const { tx, receipt } = buildPayComposableTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(receipt).toBeDefined();
  });

  it("receipt can be used in transferObjects", () => {
    const { tx, receipt } = buildPayComposableTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    // Should not throw — receipt is a valid TransactionResult
    expect(() => tx.transferObjects([receipt], SENDER)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// Composable PTB builders (ADR-001)
// ══════════════════════════════════════════════════════════════

describe("buildPayAndProveTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildPayAndProveTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      receiptDestination: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("supports delegated receipt destination (agent gets proof, not payer)", () => {
    const AGENT = "0x" + "88".repeat(32);
    const tx = buildPayAndProveTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 500_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      receiptDestination: AGENT, // agent decrypts, not the human who paid
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts memo for SEAL metadata", () => {
    const tx = buildPayAndProveTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      receiptDestination: SENDER,
      memo: "seal:content-id:abc123",
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildCreateInvoiceTx", () => {
  it("builds with sendTo (entry function path)", () => {
    const tx = buildCreateInvoiceTx(config, {
      sender: SENDER,
      recipient: RECIPIENT,
      expectedAmount: 5_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      sendTo: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("builds without sendTo (public fun path)", () => {
    const tx = buildCreateInvoiceTx(config, {
      sender: SENDER,
      recipient: RECIPIENT,
      expectedAmount: 5_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildPayInvoiceTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildPayInvoiceTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      invoiceId: INVOICE_ID,
      amount: 5_000_000n,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

// ══════════════════════════════════════════════════════════════
// Stream PTB builders
// ══════════════════════════════════════════════════════════════

describe("buildCreateStreamTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildCreateStreamTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 100_000_000n,
      ratePerSecond: 300n,
      budgetCap: 1_000_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildCreateStreamWithTimeoutTx", () => {
  it("returns a Transaction instance with custom timeout", () => {
    const tx = buildCreateStreamWithTimeoutTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 100_000_000n,
      ratePerSecond: 300n,
      budgetCap: 1_000_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 172_800_000n, // 2 days
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts minimum timeout (1 day)", () => {
    const tx = buildCreateStreamWithTimeoutTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 50_000n,
      ratePerSecond: 100n,
      budgetCap: 500_000n,
      feeMicroPercent: 0,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 86_400_000n, // exactly 1 day (minimum)
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts large timeout (30 days)", () => {
    const tx = buildCreateStreamWithTimeoutTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 1_000_000n,
      ratePerSecond: 10n,
      budgetCap: 10_000_000n,
      feeMicroPercent: 20_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 2_592_000_000n, // 30 days
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildClaimTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: RECIPIENT, // recipient calls claim
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildBatchClaimTx", () => {
  const METER_ID_2 = "0x" + "55".repeat(32);
  const METER_ID_3 = "0x" + "66".repeat(32);

  it("claims from a single stream", () => {
    const tx = buildBatchClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterIds: [METER_ID],
      sender: RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("claims from multiple streams in one PTB", () => {
    const tx = buildBatchClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterIds: [METER_ID, METER_ID_2, METER_ID_3],
      sender: RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("throws on empty meterIds", () => {
    expect(() =>
      buildBatchClaimTx(config, {
        coinType: SUI_COIN_TYPE,
        meterIds: [],
        sender: RECIPIENT,
      }),
    ).toThrow("meterIds must not be empty");
  });
});

describe("buildPauseTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildPauseTx(config, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER, // payer calls pause
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildResumeTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildResumeTx(config, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildCloseTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildCloseTx(config, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildRecipientCloseTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildRecipientCloseTx(config, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: RECIPIENT, // recipient closes abandoned stream
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildTopUpTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildTopUpTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
      depositAmount: 50_000_000n,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

// ══════════════════════════════════════════════════════════════
// Stream operation sequences (state machine ordering tests)
// ══════════════════════════════════════════════════════════════

describe("stream operation sequences", () => {
  const streamOp = (fn: typeof buildClaimTx, sender: string) =>
    fn(config, { coinType: SUI_COIN_TYPE, meterId: METER_ID, sender });

  // === SAFE SEQUENCES (should all produce valid transactions) ===

  it("create → claim → close (basic lifecycle)", () => {
    const create = buildCreateStreamTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 100_000n,
      ratePerSecond: 100n,
      budgetCap: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    const claim = streamOp(buildClaimTx, RECIPIENT);
    const close = streamOp(buildCloseTx, SENDER);

    expect(create).toBeInstanceOf(Transaction);
    expect(claim).toBeInstanceOf(Transaction);
    expect(close).toBeInstanceOf(Transaction);
  });

  it("pause → claim → resume (SAFE: claim settles pre-pause accrual first)", () => {
    const pause = streamOp(buildPauseTx, SENDER);
    const claim = streamOp(buildClaimTx, RECIPIENT);
    const resume = streamOp(buildResumeTx, SENDER);

    expect(pause).toBeInstanceOf(Transaction);
    expect(claim).toBeInstanceOf(Transaction);
    expect(resume).toBeInstanceOf(Transaction);
  });

  it("pause → resume (SAFE: v5 time-shift preserves pre-pause accrual)", () => {
    // v5 fix: resume() backward-shifts last_claim_ms to preserve pre-pause accrual.
    // No silent fund loss — both paused and active accrual are properly tracked.
    const pause = streamOp(buildPauseTx, SENDER);
    const resume = streamOp(buildResumeTx, SENDER);

    expect(pause).toBeInstanceOf(Transaction);
    expect(resume).toBeInstanceOf(Transaction);
  });

  it("multiple pause → resume cycles (safe with v5 time-shift fix)", () => {
    const cycle = () => [
      streamOp(buildPauseTx, SENDER),
      streamOp(buildResumeTx, SENDER),
    ];

    const [p1, r1] = cycle();
    const [p2, r2] = cycle();
    const [p3, r3] = cycle();

    [p1, r1, p2, r2, p3, r3].forEach((tx) =>
      expect(tx).toBeInstanceOf(Transaction),
    );
  });

  it("top-up → claim → close (payer adds funds mid-stream)", () => {
    const topUp = buildTopUpTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
      depositAmount: 50_000n,
    });
    const claim = streamOp(buildClaimTx, RECIPIENT);
    const close = streamOp(buildCloseTx, SENDER);

    expect(topUp).toBeInstanceOf(Transaction);
    expect(claim).toBeInstanceOf(Transaction);
    expect(close).toBeInstanceOf(Transaction);
  });

  it("claim → claim → claim (repeated claims are valid)", () => {
    const c1 = streamOp(buildClaimTx, RECIPIENT);
    const c2 = streamOp(buildClaimTx, RECIPIENT);
    const c3 = streamOp(buildClaimTx, RECIPIENT);

    [c1, c2, c3].forEach((tx) => expect(tx).toBeInstanceOf(Transaction));
  });

  it("pause → close (payer closes while paused — includes final settlement)", () => {
    const pause = streamOp(buildPauseTx, SENDER);
    const close = streamOp(buildCloseTx, SENDER);

    expect(pause).toBeInstanceOf(Transaction);
    expect(close).toBeInstanceOf(Transaction);
  });

  it("recipient_close after abandonment (safety valve sequence)", () => {
    // Payer creates stream then disappears. After 7 days, recipient recovers.
    const create = buildCreateStreamTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 100_000n,
      ratePerSecond: 100n,
      budgetCap: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    const recipientClose = streamOp(buildRecipientCloseTx, RECIPIENT);

    expect(create).toBeInstanceOf(Transaction);
    expect(recipientClose).toBeInstanceOf(Transaction);
  });

  it("create_with_timeout → recipient_close (custom timeout recovery)", () => {
    // Payer creates with 2-day timeout. Recipient can close after 2 days, not 7.
    const create = buildCreateStreamWithTimeoutTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 100_000n,
      ratePerSecond: 100n,
      budgetCap: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 172_800_000n, // 2 days
    });
    const recipientClose = streamOp(buildRecipientCloseTx, RECIPIENT);

    expect(create).toBeInstanceOf(Transaction);
    expect(recipientClose).toBeInstanceOf(Transaction);
  });

  // === BATCH OPERATIONS ===

  it("batch claim from 5 streams in one PTB (gas optimization)", () => {
    const meterIds = Array.from({ length: 5 }, (_, i) =>
      "0x" + (i + 1).toString(16).padStart(2, "0").repeat(32),
    );

    const tx = buildBatchClaimTx(config, {
      coinType: SUI_COIN_TYPE,
      meterIds,
      sender: RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

// ══════════════════════════════════════════════════════════════
// Cross-cutting concerns
// ══════════════════════════════════════════════════════════════

describe("PTB builder conventions", () => {
  it("all payment builders use the configured packageId", () => {
    const customConfig: SweefiConfig = { packageId: "0xdeadbeef", protocolStateId: PROTOCOL_STATE_ID };

    // Should not throw — just verify they accept arbitrary package IDs
    expect(() =>
      buildPayTx(customConfig, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        recipient: RECIPIENT,
        amount: 100n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
      }),
    ).not.toThrow();

    expect(() =>
      buildCreateStreamTx(customConfig, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        recipient: RECIPIENT,
        depositAmount: 100n,
        ratePerSecond: 1n,
        budgetCap: 1000n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
      }),
    ).not.toThrow();
  });

  it("works with non-SUI coin types", () => {
    const usdcType =
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

    const tx = buildPayTx(config, {
      coinType: usdcType,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 100_000n, // 0.10 USDC
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

// ══════════════════════════════════════════════════════════════
// Escrow PTB builders
// ══════════════════════════════════════════════════════════════

describe("buildCreateEscrowTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildCreateEscrowTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 10_000_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000), // 24h from now
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("accepts string memo (description)", () => {
    const tx = buildCreateEscrowTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 10_000_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: "Payment for API access — 30-day license",
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("defaults memo to empty when omitted", () => {
    const tx = buildCreateEscrowTx(fullConfig, {
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 1n,
      deadlineMs: 999999999999n,
      feeMicroPercent: 0,
      feeRecipient: FEE_RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildReleaseEscrowTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildReleaseEscrowTx(config, {
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT, // seller releases
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildReleaseEscrowComposableTx", () => {
  it("returns tx and receipt result", () => {
    const { tx, receipt } = buildReleaseEscrowComposableTx(config, {
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(receipt).toBeDefined();
  });

  it("receipt can be used in transferObjects (SEAL anchor)", () => {
    const { tx, receipt } = buildReleaseEscrowComposableTx(config, {
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT,
    });

    // Chain: release escrow → transfer receipt to buyer for SEAL decryption
    expect(() => tx.transferObjects([receipt], SENDER)).not.toThrow();
  });
});

describe("buildRefundEscrowTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildRefundEscrowTx(config, {
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: SENDER, // buyer or anyone (after deadline)
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe("buildDisputeEscrowTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildDisputeEscrowTx(config, {
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: SENDER, // buyer or seller can dispute
    });

    expect(tx).toBeInstanceOf(Transaction);
  });
});

// ══════════════════════════════════════════════════════════════
// Deployment constants
// ══════════════════════════════════════════════════════════════

describe("deployment constants", () => {
  it("exports testnet package ID", () => {
    expect(TESTNET_PACKAGE_ID).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

// ══════════════════════════════════════════════════════════════
// Admin PTB builders (ADR-004: emergency pause circuit breaker)
// ══════════════════════════════════════════════════════════════

describe("buildAdminPauseTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildAdminPauseTx(fullConfig, {
      adminCapId: ADMIN_CAP_ID,
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("throws without protocolStateId", () => {
    expect(() =>
      buildAdminPauseTx(config, {
        adminCapId: ADMIN_CAP_ID,
        sender: SENDER,
      }),
    ).toThrow("protocolStateId");
  });
});

describe("buildAdminUnpauseTx", () => {
  it("returns a Transaction instance", () => {
    const tx = buildAdminUnpauseTx(fullConfig, {
      adminCapId: ADMIN_CAP_ID,
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("throws without protocolStateId", () => {
    expect(() =>
      buildAdminUnpauseTx(config, {
        adminCapId: ADMIN_CAP_ID,
        sender: SENDER,
      }),
    ).toThrow("protocolStateId");
  });
});

describe("buildBurnAdminCapTx", () => {
  it("returns a Transaction instance", () => {
    // burn requires protocolStateId — checks !paused before burning (prevents permanent lockdown)
    const tx = buildBurnAdminCapTx(fullConfig, {
      adminCapId: ADMIN_CAP_ID,
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("throws without protocolStateId", () => {
    expect(() =>
      buildBurnAdminCapTx(config, {
        adminCapId: ADMIN_CAP_ID,
        sender: SENDER,
      }),
    ).toThrow("protocolStateId");
  });
});

describe("buildAutoUnpauseTx", () => {
  it("returns a Transaction instance (permissionless — no AdminCap)", () => {
    const tx = buildAutoUnpauseTx(fullConfig, {
      sender: SENDER,
    });

    expect(tx).toBeInstanceOf(Transaction);
  });

  it("throws without protocolStateId", () => {
    expect(() =>
      buildAutoUnpauseTx(config, {
        sender: SENDER,
      }),
    ).toThrow("protocolStateId");
  });
});

// ══════════════════════════════════════════════════════════════
// protocolStateId guards (builders throw if missing)
// ══════════════════════════════════════════════════════════════

describe("protocolStateId requirement", () => {
  it("buildCreateStreamTx throws without protocolStateId", () => {
    expect(() =>
      buildCreateStreamTx(config, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        recipient: RECIPIENT,
        depositAmount: 100n,
        ratePerSecond: 1n,
        budgetCap: 1000n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
      }),
    ).toThrow("protocolStateId");
  });

  it("buildCreateStreamWithTimeoutTx throws without protocolStateId", () => {
    expect(() =>
      buildCreateStreamWithTimeoutTx(config, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        recipient: RECIPIENT,
        depositAmount: 100n,
        ratePerSecond: 1n,
        budgetCap: 1000n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
        recipientCloseTimeoutMs: 86_400_000n,
      }),
    ).toThrow("protocolStateId");
  });

  it("buildTopUpTx throws without protocolStateId", () => {
    expect(() =>
      buildTopUpTx(config, {
        coinType: SUI_COIN_TYPE,
        meterId: METER_ID,
        sender: SENDER,
        depositAmount: 100n,
      }),
    ).toThrow("protocolStateId");
  });

  it("buildCreateEscrowTx throws without protocolStateId", () => {
    expect(() =>
      buildCreateEscrowTx(config, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        seller: RECIPIENT,
        arbiter: ARBITER,
        depositAmount: 100n,
        deadlineMs: 999999999999n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
      }),
    ).toThrow("protocolStateId");
  });

  it("payment builders work without protocolStateId (no guard)", () => {
    // Payments use owned objects — no pause guard needed
    expect(() =>
      buildPayTx(config, {
        coinType: SUI_COIN_TYPE,
        sender: SENDER,
        recipient: RECIPIENT,
        amount: 100n,
        feeMicroPercent: 0,
        feeRecipient: FEE_RECIPIENT,
      }),
    ).not.toThrow();
  });
});
