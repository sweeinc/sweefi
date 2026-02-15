import { x402Facilitator } from "@sweepay/core/facilitator";
import { toFacilitatorSuiSigner } from "@sweepay/sui";
import { registerExactSuiScheme } from "@sweepay/sui/exact/facilitator";
import { registerPrepaidSuiScheme } from "@sweepay/sui/prepaid/facilitator";
import type { Config } from "./config";

/**
 * Create and configure the x402 facilitator with Sui support.
 */
export function createFacilitator(config: Config): x402Facilitator {
  const facilitator = new x402Facilitator();

  const rpcUrls: Record<string, string> = {};
  if (config.SUI_MAINNET_RPC) rpcUrls["sui:mainnet"] = config.SUI_MAINNET_RPC;
  if (config.SUI_TESTNET_RPC) rpcUrls["sui:testnet"] = config.SUI_TESTNET_RPC;

  // TODO: If FACILITATOR_KEYPAIR is set, decode and use for gas sponsorship
  const signer = toFacilitatorSuiSigner(
    Object.keys(rpcUrls).length > 0 ? { rpcUrls } : undefined,
  );

  registerExactSuiScheme(facilitator, {
    signer,
    networks: ["sui:testnet", "sui:mainnet"],
  });

  registerPrepaidSuiScheme(facilitator, {
    signer,
    networks: ["sui:testnet", "sui:mainnet"],
  });

  return facilitator;
}
