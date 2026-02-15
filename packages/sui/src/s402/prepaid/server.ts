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
import type { Network } from '@sweepay/core/types';
import { getUsdcCoinType } from '../../utils.js';

export class PrepaidSuiServerScheme implements s402ServerScheme {
  readonly scheme = 'prepaid' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    const prepaid = config.prepaid;
    if (!prepaid) {
      throw new Error('Prepaid route config requires prepaid section');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['prepaid', 'exact'],
      network: config.network,
      asset: config.asset ?? getUsdcCoinType(config.network as Network),
      // For prepaid, "amount" = the minimum deposit
      amount: prepaid.minDeposit,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      prepaid: {
        ratePerCall: prepaid.ratePerCall,
        maxCalls: prepaid.maxCalls,
        minDeposit: prepaid.minDeposit,
        withdrawalDelayMs: prepaid.withdrawalDelayMs,
      },
    };
  }
}
