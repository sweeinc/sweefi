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
  s402PaymentPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';
import { PrepaidContract } from '../../transactions/prepaid.js';
import { createBuilderConfig } from '../../utils/config.js';
import { verifySuiSettlement } from '../verify.js';

export class PrepaidSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'prepaid' as const;
  readonly #contract: PrepaidContract;

  constructor(
    private readonly signer: ClientSuiSigner,
    config: SweefiConfig,
  ) {
    this.#contract = new PrepaidContract(createBuilderConfig({
      packageId: config.packageId,
      protocolState: config.protocolStateId,
    }));
  }

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

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    if (prepaid.providerPubkey) {
      // v0.2: signed receipts + fraud proofs
      const disputeWindowMs = BigInt(prepaid.disputeWindowMs!);
      const withdrawalDelay = BigInt(withdrawalDelayMs);

      // Client-side validation: mirrors Move's EWithdrawalDelayTooShort assert
      if (withdrawalDelay < disputeWindowMs) {
        throw new Error(
          `withdrawalDelayMs (${withdrawalDelay}) must be >= disputeWindowMs (${disputeWindowMs})`
        );
      }

      this.#contract.depositWithReceipts({
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
      })(tx);
    } else {
      // v0.1: economic security only
      this.#contract.deposit({
        coinType: asset,
        sender: this.signer.address,
        provider: payTo,
        amount: BigInt(amount),
        ratePerCall: BigInt(ratePerCall),
        maxCalls: maxCalls ? BigInt(maxCalls) : undefined,
        withdrawalDelayMs: BigInt(withdrawalDelayMs),
        feeMicroPercent,
        feeRecipient,
      })(tx);
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

  // The deposit TX is client-signed — S8 digest binding applies.
  // Receipt-chain verification is a separate concern for the claim phase.
  verifySettlement(
    payload: s402PaymentPayload,
    settleResponse: s402SettleResponse,
  ): s402SettlementVerification {
    return verifySuiSettlement('prepaid', payload, settleResponse);
  }
}
