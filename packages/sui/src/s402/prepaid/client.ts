/**
 * s402 Prepaid Scheme — Client
 *
 * Builds a signed deposit PTB that creates a PrepaidBalance shared object.
 * The agent deposits funds and sets rate/maxCalls parameters.
 * After settlement, the provider can claim against the balance via cumulative call counts.
 *
 * Uses the existing buildDepositTx PTB builder from ptb/prepaid.ts.
 */

import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PrepaidPayload,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { buildDepositTx } from '../../ptb/prepaid.js';

export class PrepaidSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'prepaid' as const;

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly config: SweefiConfig,
  ) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402PrepaidPayload> {
    const prepaid = requirements.prepaid;
    if (!prepaid) {
      throw new Error('Prepaid requirements missing prepaid config');
    }

    const { amount, asset, payTo } = requirements;
    const ratePerCall = prepaid.ratePerCall;
    const maxCalls = prepaid.maxCalls;
    const withdrawalDelayMs = prepaid.withdrawalDelayMs;

    // Build deposit PTB using existing builder
    const tx = buildDepositTx(this.config, {
      coinType: asset,
      sender: this.signer.address,
      provider: payTo,
      amount: BigInt(amount),
      ratePerCall: BigInt(ratePerCall),
      maxCalls: maxCalls ? BigInt(maxCalls) : undefined,
      withdrawalDelayMs: BigInt(withdrawalDelayMs),
      // Fee params from requirements
      feeBps: requirements.protocolFeeBps ?? 0,
      feeRecipient: requirements.protocolFeeAddress ?? payTo,
    });

    // Sign but do NOT execute — the facilitator broadcasts during settle
    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'prepaid',
      payload: {
        transaction: bytes,
        signature,
        ratePerCall,
        maxCalls,
      },
    };
  }
}
