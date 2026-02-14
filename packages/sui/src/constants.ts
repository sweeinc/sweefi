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
