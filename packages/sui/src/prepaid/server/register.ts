import { x402ResourceServer } from "@sweepay/core/server";
import type { Network } from "@sweepay/core/types";
import { PrepaidSuiScheme, type PrepaidServerConfig } from "./scheme";

/**
 * Configuration options for registering prepaid Sui scheme to an x402ResourceServer
 */
export interface PrepaidSuiResourceServerConfig {
  /** Prepaid-specific configuration */
  prepaid: PrepaidServerConfig;
  /** Optional specific networks to register. If not provided, registers with "sui:*" wildcard. */
  networks?: Network[];
}

/**
 * Registers the prepaid Sui payment scheme to an existing x402ResourceServer instance.
 *
 * @example
 * ```typescript
 * registerPrepaidSuiScheme(server, {
 *   prepaid: {
 *     ratePerCall: "1000000",  // 1 USDC per call
 *     minDeposit: "10000000",  // 10 USDC minimum deposit
 *     withdrawalDelayMs: "3600000",  // 1 hour grace period
 *   },
 * });
 * ```
 */
export function registerPrepaidSuiScheme(
  server: x402ResourceServer,
  config: PrepaidSuiResourceServerConfig,
): x402ResourceServer {
  const scheme = new PrepaidSuiScheme(config.prepaid);

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      server.register(network, scheme);
    });
  } else {
    server.register("sui:*", scheme);
  }

  return server;
}
