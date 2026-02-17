/**
 * s402 Escrow Scheme — Server
 *
 * Builds escrow payment requirements from route config.
 * Without this, no resource server can advertise escrow as an accepted scheme.
 */

import type { s402ServerScheme, s402RouteConfig } from 's402';
import type { s402PaymentRequirements, s402Scheme } from 's402';
import { S402_VERSION } from 's402';

export class EscrowSuiServerScheme implements s402ServerScheme {
  readonly scheme = 'escrow' as const;

  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.escrow) {
      throw new Error('Escrow config required for escrow scheme');
    }

    const accepts: s402Scheme[] = [...new Set([...config.schemes, 'exact' as const])];

    return {
      s402Version: S402_VERSION,
      accepts,
      network: config.network,
      asset: config.asset ?? '0x2::sui::SUI',
      amount: config.price,
      payTo: config.payTo,
      facilitatorUrl: config.facilitatorUrl,
      protocolFeeBps: config.protocolFeeBps,
      escrow: {
        seller: config.escrow.seller ?? config.payTo,
        arbiter: config.escrow.arbiter,
        deadlineMs: config.escrow.deadlineMs,
      },
    };
  }
}
