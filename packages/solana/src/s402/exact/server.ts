/**
 * s402 Exact Scheme — Server (Solana)
 *
 * Builds s402PaymentRequirements for a one-shot exact payment.
 * The server advertises: "Send exactly X of token Y to address Z."
 *
 * Solana mapping:
 *   - `asset`   = SPL token mint address (or NATIVE_SOL_MINT for SOL)
 *   - `amount`  = token amount in smallest unit (lamports for SOL, e.g. 6-decimal
 *                 integer for USDC: "$1.00 USDC" → "1000000")
 *   - `payTo`   = server's Solana wallet address (base58)
 *   - `network` = CAIP-2 e.g. 'solana:mainnet-beta', 'solana:devnet'
 *
 * NOTE: Only the Exact scheme is implemented. Prepaid/Stream/Escrow require
 * Anchor programs that do not yet exist for Solana.
 */

import type { s402ServerScheme, s402PaymentRequirements, s402RouteConfig } from 's402';
import { S402_VERSION } from 's402';
import { getDefaultUsdcMint } from '../../utils/connection.js';

// ─── ExactSolanaServerScheme ──────────────────────────────────────────────────

export class ExactSolanaServerScheme implements s402ServerScheme {
  readonly scheme = 'exact' as const;

  /**
   * Build payment requirements for a Solana exact payment route.
   *
   * Minimal config:
   *   { network: 'solana:devnet', payTo: '<base58 address>', amount: '1000000' }
   *
   * With fee split:
   *   { ..., protocolFeeBps: 50, protocolFeeAddress: '<fee wallet base58>' }
   */
  buildRequirements(config: s402RouteConfig): s402PaymentRequirements {
    if (!config.price) {
      throw new Error(
        'ExactSolanaServerScheme: route config requires `price` (smallest unit string)',
      );
    }

    return {
      s402Version: S402_VERSION,
      accepts: ['exact'],
      network: config.network,
      // Default to USDC for the detected network if no asset is specified
      asset: config.asset ?? getDefaultUsdcMint(config.network),
      amount: config.price,
      payTo: config.payTo,
      protocolFeeBps: config.protocolFeeBps,
    };
  }
}
