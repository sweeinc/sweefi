import { s402Facilitator } from "s402";
import { toFacilitatorSuiSigner } from "@sweefi/sui";
import {
  ExactSuiFacilitatorScheme,
  PrepaidSuiFacilitatorScheme,
  StreamSuiFacilitatorScheme,
  EscrowSuiFacilitatorScheme,
} from "@sweefi/sui";
import type { Config } from "./config";

/**
 * Create and configure the s402 facilitator with Sui support.
 */
export function createFacilitator(config: Config): s402Facilitator {
  const facilitator = new s402Facilitator();

  const rpcUrls: Record<string, string> = {};
  if (config.SUI_MAINNET_RPC) rpcUrls["sui:mainnet"] = config.SUI_MAINNET_RPC;
  if (config.SUI_TESTNET_RPC) rpcUrls["sui:testnet"] = config.SUI_TESTNET_RPC;

  // TODO: If FACILITATOR_KEYPAIR is set, decode and use for gas sponsorship
  const signer = toFacilitatorSuiSigner(
    Object.keys(rpcUrls).length > 0 ? { rpcUrls } : undefined,
  );

  // Package ID for event anti-spoofing verification. When set, facilitator
  // scheme handlers verify that Move events originate from this package,
  // preventing attackers from deploying contracts that emit fake events.
  const packageId = config.SWEEFI_PACKAGE_ID;

  const networks = ["sui:testnet", "sui:mainnet"];

  for (const network of networks) {
    facilitator.register(network, new ExactSuiFacilitatorScheme(signer));
    facilitator.register(network, new PrepaidSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new StreamSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new EscrowSuiFacilitatorScheme(signer, packageId));
  }

  return facilitator;
}
