/**
 * s402 Stream Scheme — Server (Solana)
 *
 * Builds s402PaymentRequirements for streaming payments.
 */

import type { s402ServerScheme, s402PaymentRequirements, s402RouteConfig } from 's402';
import { S402_VERSION } from 's402';
import { getDefaultUsdcMint } from '../../utils/connection.js';

export class StreamSolanaServerScheme implements s402ServerScheme {
  readonly scheme = 'stream' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.stream) {
      throw new Error('StreamSolanaServerScheme: route config requires `stream` object');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['stream', 'exact'],
      network: config.network,
      asset: config.asset ?? getDefaultUsdcMint(config.network),
      amount: config.stream.minDeposit,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      stream: config.stream,
    };
  }
}
