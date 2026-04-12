/**
 * Sui s402 Client
 *
 * High-level client that registers all Sui payment schemes and wraps fetch
 * for automatic 402 payment handling. Extends the chain-agnostic
 * wrapFetchWithS402 from @sweefi/hono with Sui-specific features:
 *   - Per-fetch memo (embedded in on-chain PaymentReceipt)
 *   - Payment metadata on Response (txDigest, receiptId, scheme, amount)
 *
 * @example
 * ```typescript
 * import { createS402Client } from '@sweefi/sui';
 * import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
 *
 * const wallet = Ed25519Keypair.generate();
 * const client = createS402Client({ wallet, network: 'sui:testnet', packageId: '0x...' });
 *
 * // Basic fetch (unchanged API)
 * const response = await client.fetch('https://api.example.com/premium/data');
 *
 * // With memo (embedded in on-chain PaymentReceipt)
 * const response2 = await client.fetch('https://api.example.com/premium/data', {
 *   s402: { memo: 'swee:idempotency:abc-123' },
 * });
 *
 * // Access payment metadata after paid fetch
 * const meta = (response2 as any).s402;
 * console.log(meta?.txDigest, meta?.scheme);
 * ```
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  s402Client,
  s402Error,
  S402_HEADERS,
  encodePaymentPayload,
  decodePaymentRequired,
  decodeSettleResponse,
} from "s402";
import type { s402PaymentRequirements } from "s402";
import { s402PaymentSentError } from "@sweefi/hono/client";
import { DEFAULT_FACILITATOR_URL } from "@sweefi/hono";
import {
  ExactSuiClientScheme,
  PrepaidSuiClientScheme,
  StreamSuiClientScheme,
  EscrowSuiClientScheme,
  UnlockSuiClientScheme,
  DirectSuiSettlement,
  verifySuiSettlement,
} from "../s402/index.js";
import { toClientSuiSigner } from "../signer.js";
import type { s402ClientConfig, S402FetchInit, S402PaymentMetadata } from "./s402-types.js";

/**
 * Attach s402 payment metadata to a Response as a non-enumerable property.
 * Non-enumerable so it doesn't show up in JSON.stringify or Object.keys,
 * but is accessible via `(response as any).s402`.
 */
function attachMetadata(response: Response, metadata: S402PaymentMetadata): void {
  Object.defineProperty(response, 's402', {
    value: metadata,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}


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

  // Pass packageId to ExactSuiClientScheme so memo-bearing payments can use
  // payment::pay_and_keep to create on-chain PaymentReceipts.
  const exactScheme = new ExactSuiClientScheme(signer, mandateConfig, packageId);
  client.register(network, exactScheme);

  if (packageId) {
    const sweefiConfig = { packageId };
    client.register(network, new PrepaidSuiClientScheme(signer, sweefiConfig));
    client.register(network, new StreamSuiClientScheme(signer, sweefiConfig));
    client.register(network, new EscrowSuiClientScheme(signer, sweefiConfig));
    client.register(network, new UnlockSuiClientScheme(signer, sweefiConfig));
  }

  const resolvedFacilitatorUrl = facilitatorUrl ?? DEFAULT_FACILITATOR_URL;

  const directSettlement = new DirectSuiSettlement(wallet, suiClient);

  /**
   * Fetch wrapper with s402 payment handling + memo + metadata.
   *
   * Extends the chain-agnostic wrapFetchWithS402 pattern with:
   *   1. Extracts `s402.memo` from init, sets it on the exact scheme
   *   2. After successful paid fetch, attaches S402PaymentMetadata to Response
   */
  async function s402Fetch(
    input: string | URL | Request,
    init?: S402FetchInit,
  ): Promise<Response> {
    // Extract s402 options and build clean RequestInit for underlying fetch
    const s402Options = init?.s402;
    let cleanInit: RequestInit | undefined;
    if (init) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { s402: _s402, ...rest } = init;
      cleanInit = Object.keys(rest).length > 0 ? rest : undefined;
    }

    // Capture memo from s402 options — will be injected into requirements below.
    // Each call has its own memo variable, so concurrent fetches don't interfere.
    const memo = s402Options?.memo;

    // Make initial request
    const response = await globalThis.fetch(input, cleanInit);

    // Not a 402 — pass through
    if (response.status !== 402) {
      return response;
    }

    // Check for payment-required header
    const headerValue = response.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
    if (!headerValue) {
      return response;
    }

    // Decode requirements
    let requirements: s402PaymentRequirements;
    try {
      requirements = decodePaymentRequired(headerValue);
    } catch {
      return response;
    }

    // Inject memo into requirements.extensions so createPayment can read it.
    // Each call has its own requirements object — no shared mutable state.
    if (memo) {
      requirements.extensions = { ...requirements.extensions, memo };
    }

    // Create payment
    const payload = await client.createPayment(requirements);

    const cachedPayload = encodePaymentPayload(payload);

    // Retry with payment header
    const retryHeaders = new Headers(cleanInit?.headers);
    retryHeaders.set(S402_HEADERS.PAYMENT, cachedPayload);

    let retryResponse: Response;
    try {
      retryResponse = await globalThis.fetch(input, {
        ...cleanInit,
        headers: retryHeaders,
      });
    } catch (networkError) {
      throw new s402PaymentSentError(requirements, networkError);
    }

    // S8: Verify causal binding + attach payment metadata
    const paymentResponseHeader = retryResponse.headers.get(S402_HEADERS.PAYMENT_RESPONSE);
    if (paymentResponseHeader) {
      try {
        const settleResponse = decodeSettleResponse(paymentResponseHeader);

        // Verify the facilitator's digest matches our signed bytes (S8)
        if (settleResponse.success) {
          const verification = verifySuiSettlement(payload.scheme, payload, settleResponse);
          if (!verification.verified) {
            throw new s402Error('DIGEST_MISMATCH', verification.reason);
          }
        }

        // Attach payment metadata to response
        if (settleResponse.success && settleResponse.txDigest) {
          attachMetadata(retryResponse, {
            txDigest: settleResponse.txDigest,
            receiptId: settleResponse.receiptId ?? undefined,
            scheme: payload.scheme,
            amount: requirements.amount,
            gasCostMist: undefined,
          });
        }
      } catch (e) {
        if (e instanceof s402Error) throw e;
        // Header decode failure — not a verification failure
      }
    }

    return retryResponse;
  }

  return {
    /** Fetch with automatic s402 payment handling, memo support, and payment metadata */
    fetch: s402Fetch,
    /** The Sui address of the paying wallet */
    address: signer.address,
    /** The configured network */
    network,
    /** The underlying s402Client (for advanced usage) */
    s402Client: client,
    /** Direct settlement (bypasses facilitator) */
    directSettlement,
    /** The facilitator URL */
    facilitatorUrl: resolvedFacilitatorUrl,
  };
}
