/**
 * Sui s402 Client
 *
 * High-level client that registers all Sui payment schemes and wraps fetch
 * for automatic 402 payment handling. Delegates fetch wrapping to
 * @sweefi/server so the core Sui package stays free of HTTP middleware.
 *
 * @example
 * ```typescript
 * import { createS402Client } from '@sweefi/sui';
 * import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
 *
 * const wallet = Ed25519Keypair.generate();
 * const client = createS402Client({ wallet, network: 'sui:testnet' });
 * const response = await client.fetch('https://api.example.com/premium/data');
 * ```
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { s402Client } from "s402";
import { wrapFetchWithS402 } from "@sweefi/server/client";
import { DEFAULT_FACILITATOR_URL } from "@sweefi/server";
import {
  ExactSuiClientScheme,
  PrepaidSuiClientScheme,
  StreamSuiClientScheme,
  EscrowSuiClientScheme,
  UnlockSuiClientScheme,
  DirectSuiSettlement,
} from "../s402/index.js";
import { toClientSuiSigner } from "../signer.js";
import type { s402ClientConfig } from "./s402-types.js";

export function createS402Client(config: s402ClientConfig) {
  const { wallet, network, rpcUrl, facilitatorUrl, packageId, mandate } = config;

  const suiNetwork = network.replace("sui:", "") as "testnet" | "mainnet" | "devnet";
  const suiClient = rpcUrl
    ? new SuiJsonRpcClient({ url: rpcUrl, network: suiNetwork })
    : new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(suiNetwork), network: suiNetwork });

  const signer = toClientSuiSigner(wallet, suiClient);

  const client = new s402Client();

  // Thread mandate config to exact scheme (requires packageId for the MoveCall target)
  if (mandate && !packageId) {
    throw new Error(
      'mandate config requires packageId — validate_and_spend needs the Move package target',
    );
  }
  const mandateConfig = mandate && packageId
    ? { mandateId: mandate.mandateId, registryId: mandate.registryId, packageId }
    : undefined;
  client.register(network, new ExactSuiClientScheme(signer, mandateConfig));

  if (packageId) {
    const sweefiConfig = { packageId };
    client.register(network, new PrepaidSuiClientScheme(signer, sweefiConfig));
    client.register(network, new StreamSuiClientScheme(signer, sweefiConfig));
    client.register(network, new EscrowSuiClientScheme(signer, sweefiConfig));
    client.register(network, new UnlockSuiClientScheme(signer, sweefiConfig));
  }

  const paidFetch = wrapFetchWithS402(globalThis.fetch, client, {
    facilitatorUrl: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
  });

  const directSettlement = new DirectSuiSettlement(wallet, suiClient);

  return {
    /** Fetch with automatic s402 payment handling */
    fetch: paidFetch,
    /** The Sui address of the paying wallet */
    address: signer.address,
    /** The configured network */
    network,
    /** The underlying s402Client (for advanced usage) */
    s402Client: client,
    /** Direct settlement (bypasses facilitator) */
    directSettlement,
    /** The facilitator URL */
    facilitatorUrl: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
  };
}
