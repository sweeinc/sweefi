import type { Network } from "@sweepay/core/types";

/**
 * Network shorthand: 'sui:testnet' | 'sui:mainnet' | 'sui:devnet' or full CAIP-2
 */
export type SuiNetwork = "sui:testnet" | "sui:mainnet" | "sui:devnet" | Network;

/**
 * Price format accepted by paymentGate().
 * Supports "$0.001", "0.001 USDC", 0.001, or explicit { amount, asset }
 */
export type Price = string | number | { amount: string; asset: string };
