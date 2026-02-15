import { x402Client, type SelectPaymentRequirements, type PaymentPolicy } from "@sweepay/core/client";
import type { Network } from "@sweepay/core/types";
import type { ClientSuiSigner } from "../../signer";
import type { SweepayConfig } from "../../ptb/types";
import { PrepaidSuiScheme } from "./scheme";

/**
 * Configuration options for registering prepaid Sui scheme to an x402Client
 */
export interface PrepaidSuiClientConfig {
  /** The Sui signer for creating payment payloads */
  signer: ClientSuiSigner;
  /** SweePay contract configuration (packageId, protocolStateId) */
  sweepayConfig: SweepayConfig;
  /** Optional payment requirements selector function */
  paymentRequirementsSelector?: SelectPaymentRequirements;
  /** Optional policies to apply to the client */
  policies?: PaymentPolicy[];
  /** Optional specific networks to register. If not provided, registers with "sui:*" wildcard. */
  networks?: Network[];
}

/**
 * Registers the prepaid Sui payment scheme to an existing x402Client instance.
 */
export function registerPrepaidSuiScheme(
  client: x402Client,
  config: PrepaidSuiClientConfig,
): x402Client {
  const scheme = new PrepaidSuiScheme(config.signer, config.sweepayConfig);

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      client.register(network, scheme);
    });
  } else {
    client.register("sui:*", scheme);
  }

  if (config.policies) {
    config.policies.forEach(policy => {
      client.registerPolicy(policy);
    });
  }

  return client;
}
