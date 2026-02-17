/**
 * Network shorthand: 'sui:testnet' | 'sui:mainnet' | 'sui:devnet'
 */
export type SuiNetwork = "sui:testnet" | "sui:mainnet" | "sui:devnet";

/**
 * Price format accepted by s402Gate().
 * Supports "$0.001", "0.001 USDC", 0.001, or explicit { amount, asset }
 */
export type Price = string | number | { amount: string; asset: string };
