import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweepayConfig, PayParams } from "./types";
import { SUI_CLOCK } from "./deployments";

// ══════════════════════════════════════════════════════════════
// Agent Mandate types
// ══════════════════════════════════════════════════════════════

/** Mandate levels — progressive autonomy */
export const MandateLevel = {
  /** L0: Read-only / cron — no spending authorization */
  READ_ONLY: 0,
  /** L1: Monitor + alert — watches prices, sends notifications, no spending */
  MONITOR: 1,
  /** L2: Capped purchasing — spends within per-tx, daily, weekly, lifetime caps */
  CAPPED: 2,
  /** L3: Autonomous — full spending within caps, post-action notify only */
  AUTONOMOUS: 3,
} as const;

export type MandateLevelValue = (typeof MandateLevel)[keyof typeof MandateLevel];

/** Parameters for creating an agent mandate */
export interface CreateAgentMandateParams {
  /** Coin type this mandate covers (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (delegator/human) address */
  sender: string;
  /** Delegate (agent) address — mandate is transferred to them */
  delegate: string;
  /** Mandate level: 0=L0, 1=L1, 2=L2, 3=L3 */
  level: MandateLevelValue;
  /** Maximum amount per transaction (base units) */
  maxPerTx: bigint;
  /** Daily spending cap (base units). 0 = no daily limit. */
  dailyLimit: bigint;
  /** Weekly spending cap (base units). 0 = no weekly limit. */
  weeklyLimit: bigint;
  /** Lifetime spending cap (base units) */
  maxTotal: bigint;
  /** Expiry timestamp in milliseconds */
  expiresAtMs: bigint;
}

/** Parameters for agent-mandated payment — validate_and_spend + pay in one PTB */
export interface AgentMandatedPayParams extends PayParams {
  /** AgentMandate object ID (owned by the delegate/agent) */
  mandateId: string;
  /** RevocationRegistry object ID (shared). Required — revocation check is mandatory. */
  registryId: string;
}

/**
 * @deprecated Use AgentMandatedPayParams — registryId is now always required.
 */
export type AgentMandatedPayCheckedParams = AgentMandatedPayParams;

/** Parameters for upgrading a mandate's level */
export interface UpgradeMandateLevelParams {
  /** Sender (delegator/human) — must be the mandate's delegator */
  sender: string;
  /** AgentMandate object ID */
  mandateId: string;
  /** Coin type (for type argument) */
  coinType: string;
  /** New level (must be higher than current) */
  newLevel: MandateLevelValue;
}

/** Parameters for updating spending caps */
export interface UpdateMandateCapsParams {
  /** Sender (delegator/human) — must be the mandate's delegator */
  sender: string;
  /** AgentMandate object ID */
  mandateId: string;
  /** Coin type (for type argument) */
  coinType: string;
  /** New max per transaction */
  maxPerTx: bigint;
  /** New daily limit (0 = no daily limit) */
  dailyLimit: bigint;
  /** New weekly limit (0 = no weekly limit) */
  weeklyLimit: bigint;
  /** New lifetime max */
  maxTotal: bigint;
}

// ══════════════════════════════════════════════════════════════
// PTB builders
// ══════════════════════════════════════════════════════════════

/**
 * Build a PTB to create an agent mandate and transfer it to the delegate.
 * Called by the delegator (human) to authorize an agent with tiered spending caps.
 */
export function buildCreateAgentMandateTx(
  config: SweepayConfig,
  params: CreateAgentMandateParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::agent_mandate::create_and_transfer`,
    typeArguments: [params.coinType],
    arguments: [
      tx.pure.address(params.delegate),
      tx.pure.u8(params.level),
      tx.pure.u64(params.maxPerTx),
      tx.pure.u64(params.dailyLimit),
      tx.pure.u64(params.weeklyLimit),
      tx.pure.u64(params.maxTotal),
      tx.pure.u64(params.expiresAtMs),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB that validates agent spending + executes payment atomically.
 * Revocation check is mandatory — there is no unchecked path.
 *
 * Flow: validate_and_spend (revocation check + debit mandate) → pay_and_keep (execute payment)
 */
export function buildAgentMandatedPayTx(
  config: SweepayConfig,
  params: AgentMandatedPayParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  // Step 1: Validate with mandatory revocation check + debit the agent mandate
  tx.moveCall({
    target: `${config.packageId}::agent_mandate::validate_and_spend`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.mandateId),
      tx.pure.u64(params.amount),
      tx.object(params.registryId),
      tx.object(SUI_CLOCK),
    ],
  });

  // Step 2: Execute the payment
  const memo = typeof params.memo === "string"
    ? new TextEncoder().encode(params.memo)
    : params.memo ?? new Uint8Array();

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::payment::pay_and_keep`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.amount),
      tx.pure.u64(params.feeBps),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * @deprecated Use buildAgentMandatedPayTx — revocation check is now mandatory on all paths.
 */
export const buildAgentMandatedPayCheckedTx = buildAgentMandatedPayTx;

/**
 * Build a PTB to upgrade an agent mandate's level.
 * Called by the delegator (human). Cannot downgrade — use revoke + recreate.
 */
export function buildUpgradeMandateLevelTx(
  config: SweepayConfig,
  params: UpgradeMandateLevelParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::agent_mandate::upgrade_level`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.mandateId),
      tx.pure.u8(params.newLevel),
    ],
  });

  return tx;
}

/**
 * Build a PTB to update spending caps on an agent mandate.
 * Called by the delegator. Useful when upgrading L1→L2 (need to set spending caps).
 */
export function buildUpdateMandateCapsTx(
  config: SweepayConfig,
  params: UpdateMandateCapsParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::agent_mandate::update_caps`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.mandateId),
      tx.pure.u64(params.maxPerTx),
      tx.pure.u64(params.dailyLimit),
      tx.pure.u64(params.weeklyLimit),
      tx.pure.u64(params.maxTotal),
    ],
  });

  return tx;
}
