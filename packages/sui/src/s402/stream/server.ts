/**
 * s402 Stream Scheme — Server
 *
 * Builds stream payment requirements from route config.
 * Phase 2: validates X-STREAM-ID header for ongoing access.
 */

import type { s402ServerScheme, s402RouteConfig } from 's402';
import type { s402PaymentRequirements, s402Scheme } from 's402';
import { S402_VERSION } from 's402';

export class StreamSuiServerScheme implements s402ServerScheme {
  readonly scheme = 'stream' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.stream) {
      throw new Error('Stream config required for stream scheme');
    }

    const accepts: s402Scheme[] = [...new Set([...config.schemes, 'exact' as const])];

    return {
      s402Version: S402_VERSION,
      accepts,
      network: config.network,
      asset: config.asset ?? '0x2::sui::SUI',
      amount: config.stream.minDeposit,
      payTo: config.payTo,
      facilitatorUrl: config.facilitatorUrl,
      protocolFeeBps: config.protocolFeeBps,
      stream: {
        ratePerSecond: config.stream.ratePerSecond,
        budgetCap: config.stream.budgetCap,
        minDeposit: config.stream.minDeposit,
        streamSetupUrl: config.facilitatorUrl,
      },
    };
  }
}
