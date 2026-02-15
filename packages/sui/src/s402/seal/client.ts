/**
 * s402 Seal Scheme — Client
 *
 * Composite: builds escrow PTB + SEAL encryption setup.
 *
 * IMPORTANT CONSTRAINT (expert-validated):
 * SEAL + mandate CANNOT be in the same PTB. ValidPtb requires all
 * commands be seal_approve from the same package. If a mandate is present,
 * the flow must be TWO separate PTBs:
 *   PTB 1: validate_and_spend() + escrow creation (mandate authorizes the spend)
 *   PTB 2: seal_approve() (SEAL key servers decrypt based on escrow receipt)
 */

import type { s402ClientScheme, s402PaymentRequirements, s402SealPayload } from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweepayConfig } from '../../ptb/types.js';
import { buildCreateEscrowTx } from '../../ptb/escrow.js';

export class SealSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'seal' as const;

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly config: SweepayConfig,
  ) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402SealPayload> {
    const seal = requirements.seal;
    if (!seal) {
      throw new Error('Seal requirements missing from s402PaymentRequirements');
    }

    // Step 1: Build escrow creation PTB (pays for the content)
    const escrow = requirements.escrow;
    const seller = escrow?.seller ?? requirements.payTo;
    const deadlineMs = escrow?.deadlineMs ?? String(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const tx = buildCreateEscrowTx(this.config, {
      coinType: requirements.asset,
      sender: this.signer.address,
      seller,
      arbiter: escrow?.arbiter ?? seller,
      depositAmount: BigInt(requirements.amount),
      deadlineMs: BigInt(deadlineMs),
      feeBps: requirements.protocolFeeBps ?? 0,
      feeRecipient: requirements.payTo,
    });

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'seal',
      payload: {
        transaction: bytes,
        signature,
        encryptionId: seal.encryptionId,
      },
    };
  }
}
