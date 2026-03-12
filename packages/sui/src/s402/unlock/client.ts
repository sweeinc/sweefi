/**
 * s402 Unlock Scheme — Client
 *
 * Composite: builds escrow PTB + encryption setup for pay-to-decrypt.
 *
 * IMPORTANT CONSTRAINT (expert-validated):
 * Encryption key-server approval + mandate CANNOT be in the same PTB.
 * ValidPtb requires all commands be from the same package. If a mandate
 * is present, the flow must be TWO separate PTBs:
 *   PTB 1: validate_and_spend() + escrow creation (mandate authorizes the spend)
 *   PTB 2: key-server approval (decrypt based on escrow receipt)
 */

import type { s402ClientScheme, s402PaymentRequirements, s402UnlockPayload } from 's402';
import { S402_VERSION } from 's402';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';
import { EscrowContract } from '../../transactions/escrow.js';
import { createBuilderConfig } from '../../utils/config.js';

export class UnlockSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'unlock' as const;
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
  ): Promise<s402UnlockPayload> {
    const unlock = requirements.unlock;
    if (!unlock) {
      throw new Error('Unlock requirements missing from s402PaymentRequirements');
    }

    // Step 1: Build escrow creation PTB (pays for the content)
    const escrow = requirements.escrow;
    const seller = escrow?.seller ?? requirements.payTo;
    const deadlineMs = escrow?.deadlineMs ?? String(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    this.#contract.create({
      coinType: requirements.asset,
      sender: this.signer.address,
      seller,
      arbiter: escrow?.arbiter ?? seller,
      depositAmount: BigInt(requirements.amount),
      deadlineMs: BigInt(deadlineMs),
      feeMicroPercent: bpsToMicroPercent(requirements.protocolFeeBps ?? 0),
      feeRecipient: requirements.payTo,
    })(tx);

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'unlock',
      payload: {
        transaction: bytes,
        signature,
        encryptionId: unlock.encryptionId,
      },
    };
  }
}
