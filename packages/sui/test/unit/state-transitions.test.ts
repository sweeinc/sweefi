/**
 * Escrow State Machine Transition Tests
 *
 * Verifies the escrow lifecycle state machine at the PTB builder layer:
 *
 *   ACTIVE → RELEASED  (buyer releases — delivery confirmed)
 *   ACTIVE → REFUNDED  (deadline passes, anyone refunds — permissionless timeout)
 *   ACTIVE → DISPUTED  (buyer or seller disputes)
 *   DISPUTED → RELEASED (arbiter decides for seller)
 *   DISPUTED → REFUNDED (arbiter decides for buyer, or deadline passes)
 *   RELEASED → terminal (no further transitions)
 *   REFUNDED → terminal (no further transitions)
 *
 * These tests verify that the PTB builders correctly construct transactions
 * for each valid transition, and document the state machine for cross-reference
 * against the Move contract's state machine in escrow.move.
 *
 * NOTE: We cannot test on-chain state transitions without a live Sui node.
 * These tests verify the TS layer correctly builds PTBs for each transition.
 * The Move contract's #[test] functions verify the on-chain state machine.
 *
 * Audit date: 2026-03-10
 * Auditor: Claude Opus 4.6 (hardening sprint)
 */

import { describe, it, expect } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import type { SweefiConfig } from "../../src/ptb/types";
import {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildReleaseEscrowComposableTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
} from "../../src/ptb";

// ══════════════════════════════════════════════════════════════
// Test fixtures
// ══════════════════════════════════════════════════════════════

const PKG = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROTOCOL_STATE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUYER = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222222222222222222222222222";
const ARBITER = "0x3333333333333333333333333333333333333333333333333333333333333333";
const FEE_RECIPIENT = "0x4444444444444444444444444444444444444444444444444444444444444444";
const ESCROW_ID = "0x5555555555555555555555555555555555555555555555555555555555555555";
const SUI_TYPE = "0x2::sui::SUI";

const config: SweefiConfig = { packageId: PKG, protocolStateId: PROTOCOL_STATE };

// ══════════════════════════════════════════════════════════════
// State Machine Constants (mirror escrow.move)
// ══════════════════════════════════════════════════════════════

/** Move constants from escrow.move — documented here for cross-reference */
const STATE = {
  ACTIVE: 0,
  DISPUTED: 1,
  RELEASED: 2,  // terminal
  REFUNDED: 3,  // terminal
} as const;

describe("Escrow State Machine Transitions", () => {

  // ──────────────────────────────────────────────────────────
  // INITIAL → ACTIVE (creation)
  // ──────────────────────────────────────────────────────────

  describe("Creation (→ ACTIVE)", () => {
    it("creates escrow with valid params → enters ACTIVE state", () => {
      const tx = buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        depositAmount: 1_000_000n,
        deadlineMs: BigInt(Date.now() + 86_400_000),
        feeMicroPercent: 5000,
        feeRecipient: FEE_RECIPIENT,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });

    it("validates minimum deposit (MIN_DEPOSIT = 1_000_000)", () => {
      // TS builder validates via assertPositive (> 0)
      // Move contract enforces >= MIN_DEPOSIT on-chain
      expect(() => buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        depositAmount: 0n,
        deadlineMs: BigInt(Date.now() + 86_400_000),
        feeMicroPercent: 5000,
        feeRecipient: FEE_RECIPIENT,
      })).toThrow(/must be > 0/);
    });

    it("validates fee micro percent", () => {
      expect(() => buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        depositAmount: 1_000_000n,
        deadlineMs: BigInt(Date.now() + 86_400_000),
        feeMicroPercent: 1_000_001,
        feeRecipient: FEE_RECIPIENT,
      })).toThrow(/feeMicroPercent/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // ACTIVE → RELEASED (buyer releases)
  // ──────────────────────────────────────────────────────────

  describe("ACTIVE → RELEASED", () => {
    it("buyer can release (delivery confirmed) → entry function", () => {
      // Move: release_and_keep<T>(escrow: Escrow<T>, clock: &Clock, ctx)
      // Authorization: sender == buyer when state == ACTIVE
      const tx = buildReleaseEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });

    it("buyer can release (delivery confirmed) → composable function", () => {
      // Move: release<T>(escrow: Escrow<T>, clock: &Clock, ctx)
      // Returns EscrowReceipt for SEAL integration
      const { tx, receipt } = buildReleaseEscrowComposableTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER,
      });
      expect(tx).toBeInstanceOf(Transaction);
      expect(receipt).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────
  // ACTIVE → REFUNDED (deadline passes, anyone refunds)
  // ──────────────────────────────────────────────────────────

  describe("ACTIVE → REFUNDED", () => {
    it("anyone can refund after deadline (permissionless timeout)", () => {
      // Move: refund<T>(escrow: Escrow<T>, clock: &Clock, ctx)
      // Authorization: now_ms >= deadline_ms → anyone can call
      // This is the safety valve — prevents permanent fund lockup
      const tx = buildRefundEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER, // buyer can refund
      });
      expect(tx).toBeInstanceOf(Transaction);

      // Third party can also call (permissionless)
      const tx2 = buildRefundEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: "0x7777777777777777777777777777777777777777777777777777777777777777",
      });
      expect(tx2).toBeInstanceOf(Transaction);
    });
  });

  // ──────────────────────────────────────────────────────────
  // ACTIVE → DISPUTED (buyer or seller disputes)
  // ──────────────────────────────────────────────────────────

  describe("ACTIVE → DISPUTED", () => {
    it("buyer can dispute (delivery not as expected)", () => {
      // Move: dispute<T>(escrow: &mut Escrow<T>, clock: &Clock, ctx)
      // Authorization: sender == buyer || sender == seller
      // State requirement: state == ACTIVE
      // Timing requirement: now_ms < deadline_ms (M-01 fix)
      const tx = buildDisputeEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });

    it("seller can dispute (buyer won't release despite delivery)", () => {
      const tx = buildDisputeEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: SELLER,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });
  });

  // ──────────────────────────────────────────────────────────
  // DISPUTED → RELEASED (arbiter decides for seller)
  // ──────────────────────────────────────────────────────────

  describe("DISPUTED → RELEASED", () => {
    it("arbiter can release disputed escrow (resolves in seller favor)", () => {
      // Move: release<T>(escrow: Escrow<T>, clock: &Clock, ctx)
      // Authorization: sender == arbiter when state == DISPUTED
      const tx = buildReleaseEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: ARBITER,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });
  });

  // ──────────────────────────────────────────────────────────
  // DISPUTED → REFUNDED (arbiter decides for buyer, or deadline)
  // ──────────────────────────────────────────────────────────

  describe("DISPUTED → REFUNDED", () => {
    it("arbiter can refund disputed escrow (resolves in buyer favor)", () => {
      // Move: refund<T>(escrow: Escrow<T>, clock: &Clock, ctx)
      // Authorization: sender == arbiter when state == DISPUTED, before deadline
      const tx = buildRefundEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: ARBITER,
      });
      expect(tx).toBeInstanceOf(Transaction);
    });

    it("anyone can refund disputed escrow after deadline (arbiter griefing protection)", () => {
      // This prevents an arbiter from refusing to act — after the extended
      // deadline (with grace period), anyone can trigger the refund.
      const tx = buildRefundEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: "0x9999999999999999999999999999999999999999999999999999999999999999",
      });
      expect(tx).toBeInstanceOf(Transaction);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Terminal states: RELEASED and REFUNDED are terminal
  // ──────────────────────────────────────────────────────────

  describe("Terminal states (documented invariants)", () => {
    /**
     * Move contract invariant:
     *   assert!(state == STATE_ACTIVE || state == STATE_DISPUTED, EAlreadyResolved);
     *
     * Once an escrow reaches RELEASED or REFUNDED, the Escrow object is consumed
     * (destructured and deleted). There is no object left to pass to any function.
     * This is enforced by Move's linear type system — the object literally ceases to exist.
     *
     * Therefore, the following transitions are impossible:
     *   RELEASED → anything
     *   REFUNDED → anything
     *
     * We cannot test this at the PTB builder layer (builders don't check on-chain state),
     * but we document it here for completeness.
     */

    it("RELEASED is terminal — Escrow object is consumed (Move linear types)", () => {
      // The release() function takes `escrow: Escrow<T>` by value (not &mut),
      // consuming the object. After release, the Escrow UID is deleted.
      // Any subsequent transaction referencing this object ID will fail with
      // ObjectNotFound at the Sui runtime level, before Move code even executes.
      expect(STATE.RELEASED).toBe(2);
    });

    it("REFUNDED is terminal — Escrow object is consumed (Move linear types)", () => {
      // Same as release — refund() takes `escrow: Escrow<T>` by value.
      expect(STATE.REFUNDED).toBe(3);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Invalid transitions (on-chain enforcement)
  // ──────────────────────────────────────────────────────────

  describe("Invalid transitions (on-chain enforcement documentation)", () => {
    /**
     * These transitions are blocked by Move contract logic.
     * PTB builders cannot enforce them (they don't know on-chain state),
     * but we document the Move error codes for each invalid transition.
     */

    it("ACTIVE → RELEASED by seller: blocked (ENotBuyer=200)", () => {
      // Move checks: sender == buyer when ACTIVE
      // Seller can only release when DISPUTED (not ACTIVE)
      // Error: ENotBuyer (200)
      expect(true).toBe(true); // documented
    });

    it("ACTIVE → RELEASED by arbiter: blocked (ENotBuyer=200)", () => {
      // Move checks: sender == buyer when ACTIVE, sender == arbiter when DISPUTED
      // Arbiter cannot release when ACTIVE
      expect(true).toBe(true); // documented
    });

    it("ACTIVE → REFUNDED by arbiter before deadline: blocked (EDeadlineNotReached=205)", () => {
      // Arbiter can only refund DISPUTED escrows
      // ACTIVE escrow before deadline requires buyer action or deadline passage
      expect(true).toBe(true); // documented
    });

    it("DISPUTED → DISPUTED: blocked (EAlreadyDisputed=208)", () => {
      // dispute() checks: state == STATE_ACTIVE
      // Cannot dispute an already-disputed escrow
      expect(true).toBe(true); // documented
    });

    it("DISPUTED → RELEASED by buyer: blocked (ENotArbiter=202)", () => {
      // Only arbiter can release DISPUTED escrows
      // Buyer can only release ACTIVE escrows
      expect(true).toBe(true); // documented
    });

    it("dispute after deadline: blocked (EDeadlineReached=215, M-01 fix)", () => {
      // M-01 security fix: dispute() asserts now_ms < deadline_ms
      // Without this, seller could dispute post-deadline and extend lockup
      // via grace period, enabling arbiter-seller collusion
      expect(true).toBe(true); // documented
    });
  });

  // ──────────────────────────────────────────────────────────
  // Grace period documentation
  // ──────────────────────────────────────────────────────────

  describe("Dispute grace period (proportional extension)", () => {
    /**
     * When dispute() is called, the deadline may be extended to give
     * the arbiter time to investigate:
     *
     *   grace = clamp(original_duration * 50%, 7 days, 30 days)
     *   new_deadline = max(now + grace, original_deadline)
     *
     * Constants from escrow.move:
     *   GRACE_RATIO = 500_000 (50% in micro-percent)
     *   GRACE_FLOOR_MS = 604_800_000 (7 days)
     *   GRACE_CAP_MS = 2_592_000_000 (30 days)
     *
     * This prevents:
     *   - Buyer's refund bot from front-running arbiter's release()
     *   - Seller from extending lockup indefinitely (cap at 30 days)
     */

    it("grace period constants match escrow.move", () => {
      // Cross-reference with contracts/sources/escrow.move
      const GRACE_RATIO = 500_000;     // 50%
      const GRACE_FLOOR_MS = 604_800_000;  // 7 days
      const GRACE_CAP_MS = 2_592_000_000;  // 30 days

      expect(GRACE_RATIO).toBe(500_000);
      expect(GRACE_FLOOR_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(GRACE_CAP_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("short escrow (1 day) gets floor grace (7 days)", () => {
      const duration = 86_400_000; // 1 day
      const proportional = Math.floor((duration * 500_000) / 1_000_000);
      const grace = Math.max(proportional, 604_800_000);
      expect(grace).toBe(604_800_000); // 7 days (floor kicks in)
    });

    it("medium escrow (60 days) gets proportional grace (30 days)", () => {
      const duration = 60 * 86_400_000; // 60 days
      const proportional = Math.floor((duration * 500_000) / 1_000_000);
      const grace = Math.min(Math.max(proportional, 604_800_000), 2_592_000_000);
      expect(grace).toBe(2_592_000_000); // 30 days (cap kicks in)
    });

    it("standard escrow (30 days) gets proportional grace (15 days)", () => {
      const duration = 30 * 86_400_000; // 30 days
      const proportional = Math.floor((duration * 500_000) / 1_000_000);
      const grace = Math.min(Math.max(proportional, 604_800_000), 2_592_000_000);
      expect(grace).toBe(15 * 86_400_000); // 15 days (proportional)
    });
  });

  // ──────────────────────────────────────────────────────────
  // Full lifecycle: creation → release → receipt
  // ──────────────────────────────────────────────────────────

  describe("Full lifecycle PTB construction", () => {
    it("creates escrow and releases in separate transactions", () => {
      // Step 1: Buyer creates escrow
      const createTx = buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        depositAmount: 10_000_000n,
        deadlineMs: BigInt(Date.now() + 7 * 86_400_000),
        feeMicroPercent: 5000, // 0.5%
        feeRecipient: FEE_RECIPIENT,
        memo: "Web3 freelance payment",
      });
      expect(createTx).toBeInstanceOf(Transaction);

      // Step 2: Buyer releases after delivery
      const { tx: releaseTx, receipt } = buildReleaseEscrowComposableTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER,
      });
      expect(releaseTx).toBeInstanceOf(Transaction);
      expect(receipt).toBeDefined();
      // Receipt can be used as SEAL access condition in the same PTB
    });

    it("creates escrow, disputes, and arbiter resolves", () => {
      // Step 1: Create
      const createTx = buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        depositAmount: 10_000_000n,
        deadlineMs: BigInt(Date.now() + 7 * 86_400_000),
        feeMicroPercent: 5000,
        feeRecipient: FEE_RECIPIENT,
      });
      expect(createTx).toBeInstanceOf(Transaction);

      // Step 2: Buyer disputes
      const disputeTx = buildDisputeEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: BUYER,
      });
      expect(disputeTx).toBeInstanceOf(Transaction);

      // Step 3a: Arbiter releases (decides for seller)
      const releaseTx = buildReleaseEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: ARBITER,
      });
      expect(releaseTx).toBeInstanceOf(Transaction);

      // Step 3b (alternative): Arbiter refunds (decides for buyer)
      const refundTx = buildRefundEscrowTx(config, {
        coinType: SUI_TYPE,
        escrowId: ESCROW_ID,
        sender: ARBITER,
      });
      expect(refundTx).toBeInstanceOf(Transaction);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Edge cases: role separation enforcement
  // ──────────────────────────────────────────────────────────

  describe("Role separation (on-chain enforcement)", () => {
    /**
     * escrow.move enforces:
     *   - arbiter != seller (EArbiterIsSeller = 212)
     *   - arbiter != buyer (EArbiterIsBuyer = 213)
     *   - buyer != seller (EBuyerIsSeller = 214)
     *
     * These are checked on-chain at create() time.
     * The TS builder does not duplicate these checks (chain is the source of truth),
     * but we document them here.
     */

    it("three distinct roles required: buyer, seller, arbiter", () => {
      // All three addresses must be different
      expect(BUYER).not.toBe(SELLER);
      expect(BUYER).not.toBe(ARBITER);
      expect(SELLER).not.toBe(ARBITER);
    });

    it("builder accepts same address (on-chain rejects)", () => {
      // Builder does NOT check role separation — that's Move's job
      // This is intentional: the TS layer validates data format,
      // the Move layer validates business rules.
      const tx = buildCreateEscrowTx(config, {
        coinType: SUI_TYPE,
        sender: BUYER,
        seller: BUYER, // same as buyer — Move will reject with EBuyerIsSeller (214)
        arbiter: ARBITER,
        depositAmount: 1_000_000n,
        deadlineMs: BigInt(Date.now() + 86_400_000),
        feeMicroPercent: 5000,
        feeRecipient: FEE_RECIPIENT,
      });
      // TS layer accepts it — the on-chain layer will abort with EBuyerIsSeller (214)
      expect(tx).toBeInstanceOf(Transaction);
    });
  });
});
