/**
 * s402 Upto Scheme — Client
 *
 * Builds a signed deposit PTB for variable-amount (upto) payments.
 * The client deposits maxAmount into an UptoDeposit proxy. The facilitator
 * later calls settle(actualAmount) where actual <= min(maxAmount, settlementCeiling),
 * returning the remainder to the payer.
 *
 * CEILING LOGIC:
 * When the server provides estimatedAmount, the client can set a tight
 * settlementCeiling (e.g., 1.2x estimate) to limit overcharge exposure.
 * Without a ceiling, the facilitator can settle up to maxAmount.
 * See s402 ADR-003 §Decision 3 and §Decision 8.
 */

import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402UptoPayload,
  s402PaymentPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import { Transaction } from '@mysten/sui/transactions';
import type { ClientSuiSigner } from '../../signer.js';
import type { SweefiConfig } from '../../ptb/types.js';
import { bpsToMicroPercent } from '../../ptb/assert.js';
import { UptoContract } from '../../transactions/upto.js';
import { createBuilderConfig } from '../../utils/config.js';
import { verifySuiSettlement } from '../verify.js';

/** Default ceiling multiplier applied to estimatedAmount (1.2x = 20% headroom) */
const DEFAULT_CEILING_MULTIPLIER = 12n;
const CEILING_MULTIPLIER_DIVISOR = 10n;

export class UptoSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'upto' as const;
  readonly #contract: UptoContract;

  constructor(
    private readonly signer: ClientSuiSigner,
    config: SweefiConfig,
  ) {
    this.#contract = new UptoContract(createBuilderConfig({
      packageId: config.packageId,
      protocolState: config.protocolStateId,
    }));
  }

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402UptoPayload> {
    const upto = requirements.upto;
    if (!upto) {
      throw new Error('Upto requirements missing from s402PaymentRequirements');
    }

    const maxAmount = BigInt(upto.maxAmount);

    // Compute settlementCeiling from estimatedAmount if available
    let settlementCeiling: bigint | undefined;
    if (upto.estimatedAmount) {
      const estimated = BigInt(upto.estimatedAmount);
      // 1.2x the estimate, capped at maxAmount
      const computed = (estimated * DEFAULT_CEILING_MULTIPLIER) / CEILING_MULTIPLIER_DIVISOR;
      settlementCeiling = computed < maxAmount ? computed : maxAmount;
      // Ensure ceiling is at least 1
      if (settlementCeiling < 1n) settlementCeiling = 1n;
    }

    // Fail fast: if the ceiling would be below estimatedAmount, the facilitator
    // will reject the deposit anyway. Don't waste gas on a doomed transaction.
    if (settlementCeiling !== undefined && upto.estimatedAmount) {
      const estimated = BigInt(upto.estimatedAmount);
      if (settlementCeiling < estimated) {
        throw new Error(
          `Settlement ceiling ${settlementCeiling} is below estimatedAmount ${estimated}. ` +
          `The facilitator will reject this deposit. Increase ceiling or remove the override.`,
        );
      }
    }

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    this.#contract.create({
      coinType: requirements.asset,
      sender: this.signer.address,
      recipient: requirements.payTo,
      maxAmount,
      settlementCeiling,
      settlementDeadlineMs: BigInt(upto.settlementDeadlineMs),
      feeMicroPercent: bpsToMicroPercent(requirements.protocolFeeBps ?? 0),
      feeRecipient: requirements.protocolFeeAddress ?? requirements.payTo,
    })(tx);

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'upto',
      payload: {
        transaction: bytes,
        signature,
        maxAmount: upto.maxAmount,
        ...(settlementCeiling !== undefined ? { settlementCeiling: settlementCeiling.toString() } : {}),
      },
    };
  }

  verifySettlement(
    payload: s402PaymentPayload,
    settleResponse: s402SettleResponse,
  ): s402SettlementVerification {
    return verifySuiSettlement('upto', payload, settleResponse);
  }
}
