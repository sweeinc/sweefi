/**
 * USDsui — Sui's native stablecoin issued by Bridge (a Stripe company).
 * Launched mainnet Mar 4, 2026. 6 decimals. GENIUS-compliant. Gasless transfers.
 */
export const USDSUI_MAINNET =
  "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI";

/**
 * Native Circle USDC on Sui (CCTP)
 * This is the canonical USDC — NOT the deprecated Wormhole-bridged version (0x5d4b...)
 */
export const USDC_MAINNET =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

/**
 * Sui testnet USDC address (Circle native USDC on testnet)
 */
export const USDC_TESTNET =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

/**
 * Native SUI coin type
 */
export const SUI_COIN_TYPE = "0x2::sui::SUI";

/**
 * USDsui decimal places (same as USDC — 6)
 */
export const USDSUI_DECIMALS = 6;

/**
 * USDC decimal places (same as Circle USDC everywhere)
 */
export const USDC_DECIMALS = 6;

/**
 * SUI decimal places
 */
export const SUI_DECIMALS = 9;

/**
 * CAIP-2 network identifiers for Sui
 */
export const SUI_MAINNET_CAIP2 = "sui:mainnet";
export const SUI_TESTNET_CAIP2 = "sui:testnet";
export const SUI_DEVNET_CAIP2 = "sui:devnet";

/**
 * Default RPC URLs for Sui networks
 */
export const MAINNET_RPC_URL = "https://fullnode.mainnet.sui.io:443";
export const TESTNET_RPC_URL = "https://fullnode.testnet.sui.io:443";
export const DEVNET_RPC_URL = "https://fullnode.devnet.sui.io:443";

/**
 * Sui address validation regex (0x followed by 64 hex characters)
 */
export const SUI_ADDRESS_REGEX = /^0x[a-fA-F0-9]{64}$/;

// ─── Coin type maps ───────────────────────────────────────────────────────────

/**
 * Well-known coin type strings on Sui (mainnet).
 * USDC: Circle native USDC. Testnet uses TESTNET_COIN_TYPES.
 * USDT: Wormhole-bridged (no Circle-native USDT on Sui yet).
 */
export const COIN_TYPES = {
  SUI: "0x2::sui::SUI",
  /** USDsui — Sui's native stablecoin issued by Bridge (Stripe). Default settlement token. */
  USDSUI:
    "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI",
  /** Circle native USDC on Sui mainnet (NOT deprecated Wormhole wUSDC 0x5d4b...) */
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  /** Wormhole-bridged USDT (mainnet) */
  USDT: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
} as const;

/** Circle native USDC on Sui testnet — different package ID from mainnet */
export const TESTNET_COIN_TYPES = {
  SUI: "0x2::sui::SUI",
  USDC: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
} as const;

/** Decimal precision for known coin types */
export const COIN_DECIMALS: Record<string, number> = {
  [COIN_TYPES.SUI]: 9,
  [COIN_TYPES.USDSUI]: 6,
  [COIN_TYPES.USDC]: 6,
  [COIN_TYPES.USDT]: 6,
  [TESTNET_COIN_TYPES.USDC]: 6,
};

export type CoinType = (typeof COIN_TYPES)[keyof typeof COIN_TYPES];

/**
 * Zero address on Sui — 0x followed by 64 zeros.
 * Use as feeRecipient when you want to disable protocol fees.
 */
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
