/**
 * s402 Exact Scheme — Client
 *
 * Builds a signed payment PTB for one-shot exact payments.
 * Reuses existing PTB logic: coinWithBalance() → transferObjects().
 *
 * FEE COLLECTION NOTE (V8 audit F-04):
 * The exact scheme's fee split currently sends both the merchant and fee
 * portions to `payTo` because `protocolFeeAddress` is never set in the
 * requirements (s402GateConfig has no such field). This means exact payments
 * are effectively fee-free at the transfer level.
 *
 * This is intentional for v0.1: exact is the simple, zero-overhead scheme.
 * Fee enforcement for escrow/stream/prepaid happens on-chain in Move contracts.
 * To enable exact-scheme fees, a future version must:
 *   1. Add `protocolFeeAddress` to s402GateConfig
 *   2. Include it in the 402 requirements
 *   3. Update ExactSuiFacilitatorScheme.verify() to check
 *      recipient got >= (amount - fee) AND feeAddress got >= fee
 */

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import type { s402ClientScheme, s402PaymentRequirements, s402ExactPayload } from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';

export class ExactSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'exact' as const;

  constructor(private readonly signer: ClientSuiSigner) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402ExactPayload> {
    const { amount, asset, payTo, protocolFeeBps, protocolFeeAddress } = requirements;

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    const totalAmount = BigInt(amount);

    if (protocolFeeBps && protocolFeeBps > 0) {
      // Split payment: merchant gets (amount - fee), protocol gets fee
      const feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n;
      const merchantAmount = totalAmount - feeAmount;
      const feeAddress = protocolFeeAddress ?? payTo;

      // V8 audit F-17: Skip the fee split when feeAmount rounds to zero.
      // This avoids creating a dust 0-value coin object that wastes gas.
      if (feeAmount === 0n) {
        const coin = coinWithBalance({ type: asset, balance: totalAmount });
        tx.transferObjects([coin], payTo);
      } else {
        // Single coin source, split into two
        const coin = coinWithBalance({ type: asset, balance: totalAmount });
        const [merchantCoin, feeCoin] = tx.splitCoins(coin, [merchantAmount, feeAmount]);
        tx.transferObjects([merchantCoin], payTo);
        tx.transferObjects([feeCoin], feeAddress);
      }
    } else {
      // Simple transfer — no fee split
      const coin = coinWithBalance({ type: asset, balance: totalAmount });
      tx.transferObjects([coin], payTo);
    }

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'exact',
      payload: {
        transaction: bytes,
        signature,
      },
    };
  }
}
