import { Transaction } from "@mysten/sui/transactions";
import type { SweepayConfig, AdminParams } from "./types";

function requireProtocolState(config: SweepayConfig): string {
  if (!config.protocolStateId) {
    throw new Error(
      "SweepayConfig.protocolStateId is required for admin operations. " +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

/**
 * Build a PTB to pause the protocol.
 * Prevents new stream/escrow creation. Existing streams and all withdrawals are unaffected.
 * Requires the AdminCap.
 */
export function buildAdminPauseTx(
  config: SweepayConfig,
  params: AdminParams,
): Transaction {
  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::admin::pause`,
    arguments: [
      tx.object(params.adminCapId),
      tx.object(protocolStateId),
    ],
  });

  return tx;
}

/**
 * Build a PTB to unpause the protocol.
 * Resumes normal operation (stream/escrow creation re-enabled).
 * Requires the AdminCap.
 */
export function buildAdminUnpauseTx(
  config: SweepayConfig,
  params: AdminParams,
): Transaction {
  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::admin::unpause`,
    arguments: [
      tx.object(params.adminCapId),
      tx.object(protocolStateId),
    ],
  });

  return tx;
}

/**
 * Build a PTB to irrevocably burn the AdminCap.
 * After burn, no one can pause/unpause — the protocol becomes fully trustless.
 * This is a one-way door. Does NOT require protocolStateId.
 */
export function buildBurnAdminCapTx(
  config: SweepayConfig,
  params: AdminParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::admin::burn_admin_cap`,
    arguments: [
      tx.object(params.adminCapId),
    ],
  });

  return tx;
}
