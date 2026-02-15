/**
 * s402 Exact Scheme — Client
 *
 * Builds a signed payment PTB for one-shot exact payments.
 * Reuses existing PTB logic: coinWithBalance() → transferObjects().
 * Adds optional protocol fee split when protocolFeeBps > 0.
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

      // Single coin source, split into two
      const coin = coinWithBalance({ type: asset, balance: totalAmount });
      const [merchantCoin, feeCoin] = tx.splitCoins(coin, [merchantAmount, feeAmount]);
      tx.transferObjects([merchantCoin], payTo);
      tx.transferObjects([feeCoin], feeAddress);
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
