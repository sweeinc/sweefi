import { Transaction } from "@mysten/sui/transactions";
import type { SweefiConfig, AdminParams } from "./types";
import { SUI_CLOCK } from "./deployments";

function requireProtocolState(config: SweefiConfig): string {
  if (!config.protocolStateId) {
    throw new Error(
      "SweefiConfig.protocolStateId is required for admin operations. " +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

/**
 * Build a PTB to pause the protocol.
 * Prevents new stream/escrow/prepaid creation. Existing streams and all withdrawals are unaffected.
 * Records timestamp for auto-unpause timer (14-day window).
 * Requires the AdminCap.
 */
export function buildAdminPauseTx(
  config: SweefiConfig,
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
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to unpause the protocol.
 * Resumes normal operation (stream/escrow/prepaid creation re-enabled).
 * Requires the AdminCap.
 */
export function buildAdminUnpauseTx(
  config: SweefiConfig,
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
 * This is a one-way door. Requires the protocol to be unpaused (prevents permanent lockdown).
 */
export function buildBurnAdminCapTx(
  config: SweefiConfig,
  params: AdminParams,
): Transaction {
  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::admin::burn_admin_cap`,
    arguments: [
      tx.object(params.adminCapId),
      tx.object(protocolStateId),
    ],
  });

  return tx;
}

/** Parameters for auto-unpause (permissionless — no AdminCap needed) */
export interface AutoUnpauseParams {
  /** Sender address (anyone can trigger) */
  sender: string;
}

/**
 * Build a PTB to trigger auto-unpause after the 14-day window.
 * Permissionless — anyone can call this. No AdminCap required.
 * Fails with EAutoUnpauseNotReady if the window hasn't elapsed.
 * Fails with ENotPaused if the protocol isn't paused.
 */
export function buildAutoUnpauseTx(
  config: SweefiConfig,
  params: AutoUnpauseParams,
): Transaction {
  const protocolStateId = requireProtocolState(config);
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::admin::auto_unpause`,
    arguments: [
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}
