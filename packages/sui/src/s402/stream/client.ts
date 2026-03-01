/**
 * s402 Stream Scheme — Client
 *
 * Two-phase streaming protocol:
 *   Phase 1 (402 exchange): Client builds stream creation PTB → submits
 *   Phase 2 (ongoing): Client includes X-STREAM-ID header on subsequent requests
 *
 * Reuses existing buildCreateStreamTx PTB builder.
 */

import type { s402ClientScheme, s402PaymentRequirements, s402StreamPayload } from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { buildCreateStreamTx } from '../../ptb/stream.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';

export class StreamSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'stream' as const;

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly config: SweefiConfig,
  ) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402StreamPayload> {
    const stream = requirements.stream;
    if (!stream) {
      throw new Error('Stream requirements missing from s402PaymentRequirements');
    }

    const tx = buildCreateStreamTx(this.config, {
      coinType: requirements.asset,
      sender: this.signer.address,
      recipient: requirements.payTo,
      depositAmount: BigInt(stream.minDeposit),
      ratePerSecond: BigInt(stream.ratePerSecond),
      budgetCap: BigInt(stream.budgetCap),
      feeMicroPercent: bpsToMicroPercent(requirements.protocolFeeBps ?? 0),
      feeRecipient: requirements.protocolFeeAddress ?? requirements.payTo,
    });

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'stream',
      payload: {
        transaction: bytes,
        signature,
      },
    };
  }
}
