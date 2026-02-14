import { x402Client, SelectPaymentRequirements, PaymentPolicy } from "@sweepay/core/client";
import type { Network } from "@sweepay/core/types";
import type { ClientSuiSigner } from "../../signer";
import { ExactSuiScheme } from "./scheme";

/**
 * Configuration options for registering Sui schemes to an x402Client
 */
export interface SuiClientConfig {
  /**
   * The Sui signer for creating payment payloads
   */
  signer: ClientSuiSigner;

  /**
   * Optional payment requirements selector function
   */
  paymentRequirementsSelector?: SelectPaymentRequirements;

  /**
   * Optional policies to apply to the client
   */
  policies?: PaymentPolicy[];

  /**
   * Optional specific networks to register.
   * If not provided, registers with "sui:*" wildcard.
   */
  networks?: Network[];
}

/**
 * Registers Sui payment schemes to an existing x402Client instance.
 *
 * @param client - The x402Client instance to register schemes to
 * @param config - Configuration for Sui client registration
 * @returns The client instance for chaining
 */
export function registerExactSuiScheme(client: x402Client, config: SuiClientConfig): x402Client {
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      client.register(network, new ExactSuiScheme(config.signer));
    });
  } else {
    client.register("sui:*", new ExactSuiScheme(config.signer));
  }

  if (config.policies) {
    config.policies.forEach(policy => {
      client.registerPolicy(policy);
    });
  }

  return client;
}
