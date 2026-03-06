/**
 * s402 Prepaid Scheme — Server
 *
 * Builds payment requirements for prepaid deposits.
 * The server advertises: "To use this API, deposit at least X with rate Y per call."
 * The client then builds a deposit PTB matching these requirements.
 */

import type {
  s402ServerScheme,
  s402PaymentRequirements,
  s402RouteConfig,
} from 's402';
import { S402_VERSION } from 's402';
import { getUsdcCoinType } from '../../utils.js';

/** Optional v0.2 signed receipt configuration for the provider. */
export interface PrepaidReceiptConfig {
  /** Provider's Ed25519 public key (hex, 64 chars without 0x prefix or 66 with). */
  providerPubkey: string;
  /** Dispute window in milliseconds. Must be ≤ withdrawalDelayMs. */
  disputeWindowMs: string;
}

export class PrepaidSuiServerScheme implements s402ServerScheme {
  readonly scheme = 'prepaid' as const;

  /**
   * @param receiptConfig - Optional v0.2 receipt configuration. When provided,
   *   the server advertises providerPubkey and disputeWindowMs in requirements,
   *   enabling signed receipt mode for agents.
   */
  constructor(private readonly receiptConfig?: PrepaidReceiptConfig) {}

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    const prepaid = config.prepaid;
    if (!prepaid) {
      throw new Error('Prepaid route config requires prepaid section');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['prepaid', 'exact'],
      network: config.network,
      asset: config.asset ?? getUsdcCoinType(config.network),
      // For prepaid, "amount" = the minimum deposit
      amount: prepaid.minDeposit,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      prepaid: {
        ratePerCall: prepaid.ratePerCall,
        maxCalls: prepaid.maxCalls,
        minDeposit: prepaid.minDeposit,
        withdrawalDelayMs: prepaid.withdrawalDelayMs,
        // v0.2 fields — only included when receipt config provided
        ...(this.receiptConfig && {
          providerPubkey: this.receiptConfig.providerPubkey,
          disputeWindowMs: this.receiptConfig.disputeWindowMs,
        }),
      },
    };
  }
}
