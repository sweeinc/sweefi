import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig, PayParams } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

// ══════════════════════════════════════════════════════════════
// Mandate types
// ══════════════════════════════════════════════════════════════

/** Parameters for creating a mandate */
export interface CreateMandateParams {
  /** Coin type this mandate covers (e.g., "0x2::sui::SUI") */
  coinType: string;
  /** Sender (delegator/human) address */
  sender: string;
  /** Delegate (agent) address — mandate is transferred to them */
  delegate: string;
  /** Maximum amount per transaction (base units) */
  maxPerTx: bigint;
  /** Lifetime spending cap (base units) */
  maxTotal: bigint;
  /** Expiry timestamp in milliseconds. null = no expiry (permanent mandate). */
  expiresAtMs: bigint | null;
}

/** Parameters for a mandated payment — validate_and_spend + pay in one PTB */
export interface MandatedPayParams extends PayParams {
  /** Mandate object ID (owned by the delegate/agent) */
  mandateId: string;
  /** RevocationRegistry object ID (shared object, mandatory for revocation checks) */
  registryId: string;
}

/** Parameters for revoking a mandate */
export interface RevokeMandateParams {
  /** Sender (delegator/human) — must own the registry */
  sender: string;
  /** RevocationRegistry object ID */
  registryId: string;
  /** Mandate object ID to revoke */
  mandateId: string;
  /** Coin type the mandate covers (for type argument) */
  coinType: string;
}

/** Parameters for creating a revocation registry */
export interface CreateRegistryParams {
  /** Sender (delegator) address */
  sender: string;
}

// ══════════════════════════════════════════════════════════════
// PTB builders
// ══════════════════════════════════════════════════════════════

/**
 * Build a PTB to create a mandate and transfer it to the delegate.
 * Called by the delegator (human) to authorize an agent to spend.
 *
 * Uses `create_and_transfer` entry function — mandate is created and
 * transferred to the delegate in one atomic operation.
 */
export function buildCreateMandateTx(
  config: SweefiConfig,
  params: CreateMandateParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::mandate::create_and_transfer`,
    typeArguments: [params.coinType],
    arguments: [
      tx.pure.address(params.delegate),
      tx.pure.u64(params.maxPerTx),
      tx.pure.u64(params.maxTotal),
      tx.pure.option("u64", params.expiresAtMs),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB that validates spending against a mandate AND executes payment
 * in a single atomic transaction.
 *
 * Flow: validate_and_spend (debit mandate) → pay_and_keep (execute payment)
 * Both happen atomically — if either fails, the whole tx reverts.
 *
 * Called by the delegate (agent). They pass the mandate they own.
 */
export function buildMandatedPayTx(
  config: SweefiConfig,
  params: MandatedPayParams,
): Transaction {
  assertFeeMicroPercent(params.feeMicroPercent, "buildMandatedPayTx");
  assertPositive(params.amount, "amount", "buildMandatedPayTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  // Step 1: Validate and debit the mandate
  tx.moveCall({
    target: `${config.packageId}::mandate::validate_and_spend`,
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
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to create a revocation registry for a delegator.
 * Each delegator needs one registry (shared object) for revoking mandates.
 */
export function buildCreateRegistryTx(
  config: SweefiConfig,
  params: CreateRegistryParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::mandate::create_registry`,
    arguments: [],
  });

  return tx;
}

/**
 * Build a PTB to revoke a mandate.
 * Called by the delegator (human) to revoke an agent's spending authorization.
 * Adds the mandate ID to the shared RevocationRegistry.
 */
export function buildRevokeMandateTx(
  config: SweefiConfig,
  params: RevokeMandateParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::mandate::revoke`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.registryId),
      tx.pure.id(params.mandateId),
    ],
  });

  return tx;
}
