/**
 * s402 Prepaid Scheme — Client
 *
 * Builds a signed deposit PTB that creates a PrepaidBalance shared object.
 * The agent deposits funds and sets rate/maxCalls parameters.
 * After settlement, the provider can claim against the balance via cumulative call counts.
 *
 * Supports both v0.1 (economic security) and v0.2 (signed receipts + fraud proofs).
 * The version is determined by the presence of `providerPubkey` in requirements.
 *
 * v0.2 note: The agent should verify the provider's key ownership out-of-band
 * using `verifyProviderKey()` before trusting a provider. This is NOT called
 * during createPayment() as it requires network round-trips to the provider.
 * See ADR-007 L2 mitigation for details.
 */

import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PrepaidPayload,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { buildDepositTx, buildDepositWithReceiptsTx } from '../../ptb/prepaid.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';

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

    // Paired validation: v0.2 fields must appear together
    if (prepaid.providerPubkey && !prepaid.disputeWindowMs) {
      throw new Error('providerPubkey requires disputeWindowMs');
    }
    if (!prepaid.providerPubkey && prepaid.disputeWindowMs) {
      throw new Error('disputeWindowMs requires providerPubkey');
    }

    // Common fee params
    const feeMicroPercent = bpsToMicroPercent(requirements.protocolFeeBps ?? 0);
    const feeRecipient = requirements.protocolFeeAddress ?? payTo;

    let tx;

    if (prepaid.providerPubkey) {
      // v0.2: signed receipts + fraud proofs
      const disputeWindowMs = BigInt(prepaid.disputeWindowMs!);
      const withdrawalDelay = BigInt(withdrawalDelayMs);

      // Client-side validation: mirrors Move's EWithdrawalDelayTooShort assert
      // for a better error message than a cryptic on-chain failure
      if (withdrawalDelay < disputeWindowMs) {
        throw new Error(
          `withdrawalDelayMs (${withdrawalDelay}) must be >= disputeWindowMs (${disputeWindowMs})`
        );
      }

      tx = buildDepositWithReceiptsTx(this.config, {
        coinType: asset,
        sender: this.signer.address,
        provider: payTo,
        amount: BigInt(amount),
        ratePerCall: BigInt(ratePerCall),
        maxCalls: maxCalls ? BigInt(maxCalls) : undefined,
        withdrawalDelayMs: withdrawalDelay,
        feeMicroPercent,
        feeRecipient,
        providerPubkey: prepaid.providerPubkey,
        disputeWindowMs,
      });
    } else {
      // v0.1: economic security only — existing path, completely unchanged
      tx = buildDepositTx(this.config, {
        coinType: asset,
        sender: this.signer.address,
        provider: payTo,
        amount: BigInt(amount),
        ratePerCall: BigInt(ratePerCall),
        maxCalls: maxCalls ? BigInt(maxCalls) : undefined,
        withdrawalDelayMs: BigInt(withdrawalDelayMs),
        feeMicroPercent,
        feeRecipient,
      });
    }

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
