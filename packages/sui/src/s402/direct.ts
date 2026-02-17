/**
 * s402 Direct Settlement — No Facilitator
 *
 * For self-sovereign agents that hold their own keys.
 * Builds, signs, broadcasts, and waits for finality in one step.
 *
 * MUST call waitForTransaction() before returning success.
 * Without finality confirmation, server could grant access for a
 * transaction that gets reverted.
 *
 * Revenue note: Direct settlement bypasses facilitator fees.
 * This is acceptable — like Uniswap, revenue comes from the hosted
 * facilitator service, not protocol enforcement.
 */

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { Signer } from '@mysten/sui/cryptography';
import { toBase64 } from '@mysten/sui/utils';
import type { s402DirectScheme, s402PaymentRequirements, s402SettleResponse } from 's402';

export class DirectSuiSettlement implements s402DirectScheme {
  readonly scheme = 'exact' as const;

  constructor(
    private readonly keypair: Signer,
    private readonly client: SuiJsonRpcClient,
  ) {}

  async settleDirectly(
    requirements: s402PaymentRequirements,
  ): Promise<s402SettleResponse> {
    const startMs = Date.now();

    // Direct settlement does not mint on-chain receipts
    if (requirements.receiptRequired) {
      return {
        success: false,
        error: 'Direct settlement does not support on-chain receipts. Use facilitator settlement instead.',
      };
    }

    try {
      // Build the payment PTB
      const tx = new Transaction();
      tx.setSender(this.keypair.toSuiAddress());

      const coin = coinWithBalance({
        type: requirements.asset,
        balance: BigInt(requirements.amount),
      });
      tx.transferObjects([coin], requirements.payTo);

      // Build and sign
      const txBytes = await tx.build({ client: this.client });
      const { signature } = await this.keypair.signTransaction(txBytes);

      // Execute on-chain
      const result = await this.client.executeTransactionBlock({
        transactionBlock: toBase64(txBytes),
        signature,
        options: { showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return {
          success: false,
          error: `Transaction failed: ${result.effects?.status?.error ?? 'unknown'}`,
        };
      }

      // CRITICAL: Wait for finality before returning success
      await this.client.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true },
      });

      const finalityMs = Date.now() - startMs;

      return {
        success: true,
        txDigest: result.digest,
        receiptId: undefined, // Direct settlement does not mint receipts
        finalityMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Direct settlement failed',
      };
    }
  }
}
