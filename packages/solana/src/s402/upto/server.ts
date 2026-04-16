/**
 * s402 Upto Scheme — Server (Solana)
 *
 * Builds s402PaymentRequirements for upto (variable-amount) payments.
 */

import type { s402ServerScheme, s402PaymentRequirements, s402RouteConfig } from 's402';
import { S402_VERSION } from 's402';
import { getDefaultUsdcMint } from '../../utils/connection.js';

export class UptoSolanaServerScheme implements s402ServerScheme {
  readonly scheme = 'upto' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.upto) {
      throw new Error('UptoSolanaServerScheme: route config requires `upto` object');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['upto', 'exact'],
      network: config.network,
      asset: config.asset ?? getDefaultUsdcMint(config.network),
      amount: config.upto.maxAmount,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      upto: config.upto,
    };
  }
}
