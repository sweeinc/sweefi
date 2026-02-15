import { x402Facilitator } from "@sweepay/core/facilitator";
import type { Network } from "@sweepay/core/types";
import type { FacilitatorSuiSigner } from "../../signer";
import { PrepaidSuiScheme } from "./scheme";

/**
 * Configuration options for registering prepaid Sui scheme to an x402Facilitator
 */
export interface PrepaidSuiFacilitatorConfig {
  /** The Sui signer for facilitator operations */
  signer: FacilitatorSuiSigner;
  /** Networks to register (single network or array of networks) */
  networks: Network | Network[];
}

/**
 * Registers the prepaid Sui payment scheme to an existing x402Facilitator instance.
 *
 * @example
 * ```typescript
 * registerPrepaidSuiScheme(facilitator, {
 *   signer: suiSigner,
 *   networks: ["sui:testnet", "sui:mainnet"],
 * });
 * ```
 */
export function registerPrepaidSuiScheme(
  facilitator: x402Facilitator,
  config: PrepaidSuiFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new PrepaidSuiScheme(config.signer));
  return facilitator;
}
