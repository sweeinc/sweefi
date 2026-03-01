import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

function requireProtocolState(config: SweefiConfig): string {
  if (!config.protocolStateId) {
    throw new Error(
      "buildCreateEscrowTx: SweefiConfig.protocolStateId is required for escrow creation. " +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

// ══════════════════════════════════════════════════════════════
// Escrow parameter types
// ══════════════════════════════════════════════════════════════

/** Parameters for creating a time-locked escrow */
export interface CreateEscrowParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (buyer) address */
  sender: string;
  /** Seller address — receives funds on release */
  seller: string;
  /** Arbiter address — can resolve disputes */
  arbiter: string;
  /** Deposit amount in smallest units */
  depositAmount: bigint;
  /** Deadline timestamp in milliseconds (auto-refund after this) */
  deadlineMs: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%), charged on release only */
  feeMicroPercent: number;
  /** Address that receives the fee */
  feeRecipient: string;
  /** Optional memo (UTF-8 string or raw bytes) */
  memo?: string | Uint8Array;
}

/** Parameters for escrow operations (release, refund, dispute) */
export interface EscrowOpParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Escrow object ID */
  escrowId: string;
  /** Sender address (seller for release, buyer/anyone for refund, buyer/seller for dispute) */
  sender: string;
}

// ══════════════════════════════════════════════════════════════
// Escrow PTB builders
// ══════════════════════════════════════════════════════════════

/**
 * Build a PTB to create a time-locked escrow.
 * The buyer deposits funds. The escrow becomes a shared object.
 * After deadline, anyone can trigger a refund (permissionless timeout).
 *
 * SEAL integration: the Escrow object ID serves as the SEAL access condition.
 * Seller encrypts deliverables → buyer decrypts after release.
 */
export function buildCreateEscrowTx(
  config: SweefiConfig,
  params: CreateEscrowParams,
): Transaction {
  assertPositive(params.depositAmount, "depositAmount", "buildCreateEscrowTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildCreateEscrowTx");

  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  const memo = typeof params.memo === "string"
    ? new TextEncoder().encode(params.memo)
    : params.memo ?? new Uint8Array();

  const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

  tx.moveCall({
    target: `${config.packageId}::escrow::create`,
    typeArguments: [params.coinType],
    arguments: [
      deposit,
      tx.pure.address(params.seller),
      tx.pure.address(params.arbiter),
      tx.pure.u64(params.deadlineMs),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the seller (or arbiter) to release escrow funds.
 * Uses `release_and_keep` entry — EscrowReceipt auto-transferred to buyer.
 * Fees are deducted on release (no fee on refund).
 * The Escrow object is consumed.
 */
export function buildReleaseEscrowTx(
  config: SweefiConfig,
  params: EscrowOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::escrow::release_and_keep`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.escrowId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a composable PTB for escrow release that returns the EscrowReceipt.
 * Uses `release` public function — the receipt is a TransactionResult for chaining.
 *
 * SEAL integration: The EscrowReceipt.escrow_id is the SEAL access condition.
 * Chain this with other calls in the same PTB for atomic pay-to-decrypt flows:
 *   payment::pay() → escrow::release() → use receipt for SEAL decryption
 *
 * @returns Object with `tx` and `receipt` (TransactionResult for the EscrowReceipt)
 */
export function buildReleaseEscrowComposableTx(
  config: SweefiConfig,
  params: EscrowOpParams,
) {
  const tx = new Transaction();
  tx.setSender(params.sender);

  const receipt = tx.moveCall({
    target: `${config.packageId}::escrow::release`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.escrowId),
      tx.object(SUI_CLOCK),
    ],
  });

  return { tx, receipt };
}

/**
 * Build a PTB to refund escrow funds to the buyer.
 * Can be triggered by: buyer (anytime if ACTIVE), arbiter (if DISPUTED),
 * or ANYONE after deadline (permissionless timeout — prevents key-loss lockup).
 * The Escrow object is consumed. No fee charged on refund.
 */
export function buildRefundEscrowTx(
  config: SweefiConfig,
  params: EscrowOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::escrow::refund`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.escrowId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to dispute an escrow.
 * Either buyer or seller can raise a dispute. Moves state from ACTIVE to DISPUTED.
 * Once disputed, only the arbiter can release or refund (or timeout triggers auto-refund).
 * The Escrow object is mutated (not consumed).
 */
export function buildDisputeEscrowTx(
  config: SweefiConfig,
  params: EscrowOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::escrow::dispute`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.escrowId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}
