/**
 * s402 Prepaid Scheme — Server (Solana)
 *
 * Builds s402PaymentRequirements for prepaid balance deposits.
 */

import type { s402ServerScheme, s402PaymentRequirements, s402RouteConfig } from 's402';
import { S402_VERSION } from 's402';
import { getDefaultUsdcMint } from '../../utils/connection.js';

export class PrepaidSolanaServerScheme implements s402ServerScheme {
  readonly scheme = 'prepaid' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.prepaid) {
      throw new Error('PrepaidSolanaServerScheme: route config requires `prepaid` object');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['prepaid', 'exact'],
      network: config.network,
      asset: config.asset ?? getDefaultUsdcMint(config.network),
      amount: config.prepaid.minDeposit,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      prepaid: config.prepaid,
    };
  }
}
