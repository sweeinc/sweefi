/**
 * s402 Upto Scheme — Server
 *
 * Builds upto payment requirements from route config.
 * The server advertises estimatedAmount (advisory) so clients can set tight ceilings.
 */

import type { s402ServerScheme, s402RouteConfig } from 's402';
import type { s402PaymentRequirements, s402Scheme } from 's402';
import { S402_VERSION } from 's402';

export class UptoSuiServerScheme implements s402ServerScheme {
  readonly scheme = 'upto' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.upto) {
      throw new Error('Upto config required for upto scheme');
    }

    const accepts: s402Scheme[] = [...new Set([...config.schemes, 'exact' as const])];

    return {
      s402Version: S402_VERSION,
      accepts,
      network: config.network,
      asset: config.asset ?? '0x2::sui::SUI',
      amount: config.upto.maxAmount,
      payTo: config.payTo,
      facilitatorUrl: config.facilitatorUrl,
      protocolFeeBps: config.protocolFeeBps,
      upto: {
        maxAmount: config.upto.maxAmount,
        settlementDeadlineMs: config.upto.settlementDeadlineMs,
        usageReportUrl: config.upto.usageReportUrl,
        estimatedAmount: config.upto.estimatedAmount,
      },
    };
  }
}
