import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

function requireProtocolState(config: SweefiConfig): string {
  if (!config.protocolStateId) {
    throw new Error(
      "buildCreateUptoDepositTx: SweefiConfig.protocolStateId is required for upto deposits. " +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

// ══════════════════════════════════════════════════════════════
// Upto parameter types
// ══════════════════════════════════════════════════════════════

/** Parameters for creating an upto deposit (variable-amount payment) */
export interface CreateUptoDepositParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (payer) address */
  sender: string;
  /** Recipient (payTo) address — receives settled funds */
  recipient: string;
  /** Maximum deposit amount in smallest units */
  maxAmount: bigint;
  /** Client-chosen settlement ceiling (optional, on-chain enforced). Must be 1 <= ceiling <= maxAmount. */
  settlementCeiling?: bigint;
  /** Deadline for settlement in milliseconds since epoch */
  settlementDeadlineMs: bigint;
  /** Fee in micro-percent (0–1,000,000 where 1,000,000 = 100%) */
  feeMicroPercent: number;
  /** Address that receives the fee */
  feeRecipient: string;
}

/** Parameters for settling an upto deposit */
export interface SettleUptoParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** UptoDeposit object ID */
  depositId: string;
  /** Sender address (facilitator/server settling the deposit) */
  sender: string;
  /** Actual amount to settle in base units. Must be <= maxAmount and <= settlementCeiling. */
  actualAmount: bigint;
}

/** Parameters for expiring an upto deposit (payer reclaims after deadline) */
export interface ExpireUptoParams {
  /** Coin type (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** UptoDeposit object ID */
  depositId: string;
  /** Sender address (anyone can call after deadline — permissionless) */
  sender: string;
}

// ══════════════════════════════════════════════════════════════
// Upto PTB builders
// ══════════════════════════════════════════════════════════════

/**
 * Build a PTB to create an upto deposit for variable-amount settlement.
 * The payer deposits maxAmount. The facilitator later settles with actualAmount <= maxAmount,
 * returning the remainder to the payer. If settlement doesn't happen before the deadline,
 * anyone can call expire() to return the full deposit.
 */
export function buildCreateUptoDepositTx(
  config: SweefiConfig,
  params: CreateUptoDepositParams,
): Transaction {
  assertPositive(params.maxAmount, "maxAmount", "buildCreateUptoDepositTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildCreateUptoDepositTx");

  if (params.settlementCeiling !== undefined) {
    if (params.settlementCeiling < 1n || params.settlementCeiling > params.maxAmount) {
      throw new Error(
        `buildCreateUptoDepositTx: settlementCeiling must be 1 <= ceiling <= maxAmount ` +
        `(got ceiling=${params.settlementCeiling}, maxAmount=${params.maxAmount})`,
      );
    }
  }

  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  const deposit = coinWithBalance({ type: params.coinType, balance: params.maxAmount });

  // Move create() derives max_amount from deposit.value() — do NOT pass maxAmount as an argument.
  // Argument order must match the Move function signature exactly (BCS is positional).
  if (params.settlementCeiling !== undefined) {
    // create_with_ceiling(deposit, recipient, settlement_ceiling, deadline, fee, fee_recipient, state, clock)
    tx.moveCall({
      target: `${config.packageId}::upto_deposit::create_with_ceiling`,
      typeArguments: [params.coinType],
      arguments: [
        deposit,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.settlementCeiling),
        tx.pure.u64(params.settlementDeadlineMs),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.object(protocolStateId),
        tx.object(SUI_CLOCK),
      ],
    });
  } else {
    // create(deposit, recipient, deadline, fee, fee_recipient, state, clock)
    tx.moveCall({
      target: `${config.packageId}::upto_deposit::create`,
      typeArguments: [params.coinType],
      arguments: [
        deposit,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.settlementDeadlineMs),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.object(protocolStateId),
        tx.object(SUI_CLOCK),
      ],
    });
  }

  return tx;
}

/**
 * Build a PTB to settle an upto deposit.
 * The facilitator calls this with the actual amount determined by usage.
 * Sends actualAmount to the recipient (minus fee), remainder back to payer.
 */
export function buildSettleUptoTx(
  config: SweefiConfig,
  params: SettleUptoParams,
): Transaction {
  assertPositive(params.actualAmount, "actualAmount", "buildSettleUptoTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::upto_deposit::settle`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.depositId),
      tx.pure.u64(params.actualAmount),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to expire an upto deposit.
 * Can be triggered by anyone after the settlement deadline.
 * Returns the full deposit to the payer. No fee charged on expiry.
 */
export function buildExpireUptoTx(
  config: SweefiConfig,
  params: ExpireUptoParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::upto_deposit::expire`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.depositId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}
