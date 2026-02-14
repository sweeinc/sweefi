import { x402Facilitator } from "@sweepay/core/facilitator";
import type { Network } from "@sweepay/core/types";
import type { FacilitatorSuiSigner } from "../../signer";
import { ExactSuiScheme } from "./scheme";

/**
 * Configuration options for registering Sui schemes to an x402Facilitator
 */
export interface SuiFacilitatorConfig {
  /**
   * The Sui signer for facilitator operations
   */
  signer: FacilitatorSuiSigner;

  /**
   * Networks to register (single network or array of networks).
   * Examples: "sui:mainnet", ["sui:mainnet", "sui:testnet"]
   */
  networks: Network | Network[];

  /**
   * Optional gas station URL for sponsored transactions
   */
  gasStationUrl?: string;
}

/**
 * Registers Sui payment schemes to an existing x402Facilitator instance.
 *
 * @param facilitator - The x402Facilitator instance to register schemes to
 * @param config - Configuration for Sui facilitator registration
 * @returns The facilitator instance for chaining
 *
 * @example
 * ```typescript
 * // Single network
 * registerExactSuiScheme(facilitator, {
 *   signer: suiSigner,
 *   networks: "sui:testnet"
 * });
 *
 * // Multiple networks
 * registerExactSuiScheme(facilitator, {
 *   signer: suiSigner,
 *   networks: ["sui:mainnet", "sui:testnet"]
 * });
 * ```
 */
export function registerExactSuiScheme(
  facilitator: x402Facilitator,
  config: SuiFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new ExactSuiScheme(config.signer, config.gasStationUrl));
  return facilitator;
}
