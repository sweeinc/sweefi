/**
 * s402 Escrow Scheme — Client
 *
 * Builds a signed escrow creation PTB for escrowed payments.
 */

import type { s402ClientScheme, s402PaymentRequirements, s402EscrowPayload } from 's402';
import { S402_VERSION } from 's402';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';
import { EscrowContract } from '../../transactions/escrow.js';
import { createBuilderConfig } from '../../utils/config.js';

export class EscrowSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'escrow' as const;
  readonly #contract: EscrowContract;

  constructor(
    private readonly signer: ClientSuiSigner,
    config: SweefiConfig,
  ) {
    this.#contract = new EscrowContract(createBuilderConfig({
      packageId: config.packageId,
      protocolState: config.protocolStateId,
    }));
  }

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402EscrowPayload> {
    const escrow = requirements.escrow;
    if (!escrow) {
      throw new Error('Escrow requirements missing from s402PaymentRequirements');
    }

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    this.#contract.create({
      coinType: requirements.asset,
      sender: this.signer.address,
      seller: escrow.seller,
      arbiter: escrow.arbiter ?? escrow.seller,
      depositAmount: BigInt(requirements.amount),
      deadlineMs: BigInt(escrow.deadlineMs),
      feeMicroPercent: bpsToMicroPercent(requirements.protocolFeeBps ?? 0),
      feeRecipient: requirements.payTo,
    })(tx);

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
