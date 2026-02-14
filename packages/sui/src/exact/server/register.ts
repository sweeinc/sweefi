import { x402ResourceServer } from "@sweepay/core/server";
import type { Network } from "@sweepay/core/types";
import { ExactSuiScheme } from "./scheme";

/**
 * Configuration options for registering Sui schemes to an x402ResourceServer
 */
export interface SuiResourceServerConfig {
  /**
   * Optional specific networks to register.
   * If not provided, registers with "sui:*" wildcard.
   */
  networks?: Network[];
}

/**
 * Registers Sui payment schemes to an existing x402ResourceServer instance.
 *
 * @param server - The x402ResourceServer instance to register schemes to
 * @param config - Configuration for Sui resource server registration
 * @returns The server instance for chaining
 */
export function registerExactSuiScheme(
  server: x402ResourceServer,
  config: SuiResourceServerConfig = {},
): x402ResourceServer {
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      server.register(network, new ExactSuiScheme());
    });
  } else {
    server.register("sui:*", new ExactSuiScheme());
  }

  return server;
}
