/**
 * s402 Escrow Scheme — Client
 *
 * Builds a signed escrow creation PTB for escrowed payments.
 * Reuses existing buildCreateEscrowTx PTB builder.
 */

import type { s402ClientScheme, s402PaymentRequirements, s402EscrowPayload } from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweepayConfig } from '../../ptb/types.js';
import { buildCreateEscrowTx } from '../../ptb/escrow.js';

export class EscrowSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'escrow' as const;

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly config: SweepayConfig,
  ) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402EscrowPayload> {
    const escrow = requirements.escrow;
    if (!escrow) {
      throw new Error('Escrow requirements missing from s402PaymentRequirements');
    }

    const tx = buildCreateEscrowTx(this.config, {
      coinType: requirements.asset,
      sender: this.signer.address,
      seller: escrow.seller,
      arbiter: escrow.arbiter ?? escrow.seller, // Default arbiter to seller if not specified
      depositAmount: BigInt(requirements.amount),
      deadlineMs: BigInt(escrow.deadlineMs),
      feeBps: requirements.protocolFeeBps ?? 0,
      feeRecipient: requirements.payTo,
    });

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'escrow',
      payload: {
        transaction: bytes,
        signature,
      },
    };
  }
}
