/**
 * s402 Upto Scheme — Client (Solana)
 *
 * Builds a signed transaction to create an upto deposit for variable-amount
 * settlement. The payer deposits a maximum and the facilitator settles the
 * actual usage, with the remainder returned.
 */

import { Transaction, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PaymentPayload,
  s402UptoPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSolanaSigner } from '../../signer.js';
import {
  buildCreateUptoIx,
  deriveUptoDepositPda,
} from '../../programs/upto.js';

export class UptoSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'upto' as const;

  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
  ) {}

  async createPayment(requirements: s402PaymentRequirements): Promise<s402PaymentPayload> {
    const { asset, payTo, protocolFeeBps, upto, expiresAt } = requirements;

    if (!upto) {
      throw new Error('Upto scheme requires requirements.upto');
    }

    const payer = new PublicKey(this.signer.address);
    const recipient = new PublicKey(payTo);
    const mint = new PublicKey(asset);
    const feeRecipient = new PublicKey(requirements.protocolFeeAddress ?? payTo);

    const maxAmount = BigInt(upto.maxAmount);
    const feeBps = protocolFeeBps ?? 0;

    // Deadline from upto.settlementDeadlineMs or expiresAt
    const deadlineMs = BigInt(upto.settlementDeadlineMs);
    const deadlineSeconds = deadlineMs / 1000n;

    const nonce = BigInt(Date.now());
    const [depositPda] = deriveUptoDepositPda(payer, recipient, nonce);

    const tx = new Transaction();

    const createIx = await buildCreateUptoIx({
      payer,
      recipient,
      mint,
      amount: maxAmount,
      deadlineSeconds,
      feeBps,
      feeRecipient,
      nonce,
    });

    tx.add(createIx);

    const { serialized, signature } = await this.signer.signTransaction(tx, this.connection);

    const payload: s402UptoPayload = {
      s402Version: S402_VERSION,
      scheme: 'upto',
      payload: {
        transaction: serialized,
        signature,
        maxAmount: maxAmount.toString(),
      },
    };

    return payload;
  }

  verifySettlement(
    _payload: s402PaymentPayload,
    settleResponse: s402SettleResponse,
  ): s402SettlementVerification {
    return {
      verified: false,
      expectedDigest: '',
      actualDigest: settleResponse.txDigest ?? null,
      reason: 'Solana upto settlement verification requires RPC lookup',
    };
  }
}
