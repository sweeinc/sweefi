import type { SuiNetwork, Price } from "../shared/types";

/**
 * Configuration for paymentGate() middleware
 */
export interface PaymentGateConfig {
  /** Price to charge per request (e.g., "$0.001", 0.001) */
  price: Price;

  /** Sui network to accept payments on */
  network: SuiNetwork;

  /** Sui address to receive payments */
  payTo: string;

  /** Facilitator URL (optional — defaults to swee-facilitator.fly.dev) */
  facilitatorUrl?: string;

  /** API key for authenticating with the facilitator */
  apiKey?: string;

  /** Maximum payment timeout in seconds (default: 30) */
  maxTimeoutSeconds?: number;
}
