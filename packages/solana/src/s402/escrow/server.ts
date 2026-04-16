/**
 * s402 Escrow Scheme — Server (Solana)
 *
 * Builds s402PaymentRequirements for escrow payments.
 */

import type { s402ServerScheme, s402PaymentRequirements, s402RouteConfig } from 's402';
import { S402_VERSION } from 's402';
import { getDefaultUsdcMint } from '../../utils/connection.js';

export class EscrowSolanaServerScheme implements s402ServerScheme {
  readonly scheme = 'escrow' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.escrow) {
      throw new Error('EscrowSolanaServerScheme: route config requires `escrow` object');
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['escrow', 'exact'],
      network: config.network,
      asset: config.asset ?? getDefaultUsdcMint(config.network),
      amount: config.price,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
      escrow: config.escrow,
    };
  }
}
