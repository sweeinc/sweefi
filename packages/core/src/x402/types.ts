/**
 * Re-export x402 protocol types through @sweepay/core.
 * This abstraction layer lets us swap the implementation later
 * without changing downstream imports.
 */
export type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SchemeNetworkClient,
  SchemeNetworkServer,
  SchemeNetworkFacilitator,
  VerifyResponse,
  SettleResponse,
  AssetAmount,
  Price,
  MoneyParser,
  ResourceInfo,
} from "@x402/core/types";
