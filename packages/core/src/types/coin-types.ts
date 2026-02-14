/**
 * Well-known coin type strings on Sui.
 * These are the Move type identifiers used by the framework and popular tokens.
 *
 * USDC: Circle native USDC (mainnet). Testnet has a different address — use TESTNET_COIN_TYPES.
 * USDT: Wormhole-bridged USDT (no Circle-native version exists on Sui yet).
 */
export const COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  /** Circle native USDC on Sui mainnet (NOT the deprecated Wormhole wUSDC 0x5d4b...) */
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  /** Wormhole-bridged USDT (mainnet) */
  USDT: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
} as const;

/** Circle native USDC on Sui testnet — different package ID from mainnet */
export const TESTNET_COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
} as const;

/** Decimal precision for known coin types */
export const COIN_DECIMALS: Record<string, number> = {
  [COIN_TYPES.SUI]: 9,
  [COIN_TYPES.USDC]: 6,
  [COIN_TYPES.USDT]: 6,
  [TESTNET_COIN_TYPES.USDC]: 6,
};

export type CoinType = (typeof COIN_TYPES)[keyof typeof COIN_TYPES];
