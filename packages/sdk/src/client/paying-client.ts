import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { x402Client } from "@sweepay/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactSuiScheme } from "@sweepay/sui/exact/client";
import { adaptWallet } from "./wallet-adapter";
import { DEFAULT_FACILITATOR_URL } from "../shared/constants";
import type { PayingClientConfig } from "./types";

/**
 * Create a fetch function that automatically handles x402 payments on Sui.
 *
 * When a request returns HTTP 402, the client automatically:
 * 1. Parses the payment requirements from the response
 * 2. Builds and signs a Sui transaction (without executing it)
 * 3. Retries the request with the payment signature header
 *
 * @example
 * ```typescript
 * import { createPayingClient } from '@sweepay/sdk/client';
 * import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
 *
 * const wallet = Ed25519Keypair.generate();
 * const client = createPayingClient({ wallet, network: 'sui:testnet' });
 *
 * const response = await client.fetch('https://api.example.com/premium/data');
 * const data = await response.json();
 * ```
 */
export function createPayingClient(config: PayingClientConfig) {
  const { wallet, network, rpcUrl, facilitatorUrl } = config;

  // Create SuiClient for transaction building
  const suiNetwork = network.replace("sui:", "") as "testnet" | "mainnet" | "devnet";
  const suiClient = rpcUrl
    ? new SuiClient({ url: rpcUrl })
    : new SuiClient({ url: getFullnodeUrl(suiNetwork) });

  // Adapt wallet to x402 signer
  const signer = adaptWallet(wallet, suiClient);

  // Create x402 client with Sui scheme
  const client = new x402Client();
  client.register(network, new ExactSuiScheme(signer));

  // Wrap global fetch with payment handling
  const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

  return {
    /**
     * Fetch with automatic x402 payment handling.
     * Drop-in replacement for global fetch().
     */
    fetch: paidFetch,

    /**
     * The Sui address of the paying wallet
     */
    address: signer.address,

    /**
     * The configured network
     */
    network,

    /**
     * The underlying x402Client (for advanced usage)
     */
    x402Client: client,

    /**
     * The facilitator URL used for payment verification
     */
    facilitatorUrl: facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
  };
}
