import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { normalizeStructTag } from "@mysten/sui/utils";
import {
  SUI_MAINNET_CAIP2,
  SUI_TESTNET_CAIP2,
  SUI_DEVNET_CAIP2,
  USDC_MAINNET,
  USDC_TESTNET,
  SUI_ADDRESS_REGEX,
} from "./constants";

/**
 * Create a SuiClient for the specified network
 *
 * @param network - CAIP-2 network identifier (e.g., "sui:mainnet")
 * @param customRpcUrl - Optional custom RPC URL override
 * @returns SuiClient configured for the specified network
 */
export function createSuiClient(network: string, customRpcUrl?: string): SuiJsonRpcClient {
  // Extract short network name from CAIP-2 format (e.g., "sui:testnet" → "testnet")
  const shortNetwork = caip2ToShortNetwork(network);

  if (customRpcUrl) {
    return new SuiJsonRpcClient({ url: customRpcUrl, network: shortNetwork });
  }

  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(shortNetwork),
    network: shortNetwork,
  });
}

function caip2ToShortNetwork(network: string): 'mainnet' | 'testnet' | 'devnet' {
  switch (network) {
    case SUI_MAINNET_CAIP2: return 'mainnet';
    case SUI_TESTNET_CAIP2: return 'testnet';
    case SUI_DEVNET_CAIP2: return 'devnet';
    default:
      throw new Error(`Unsupported Sui network: ${network}`);
  }
}

/**
 * Get the default USDC coin type for a network
 *
 * @param network - CAIP-2 network identifier
 * @returns USDC coin type string
 */
export function getUsdcCoinType(network: string): string {
  switch (network) {
    case SUI_MAINNET_CAIP2:
      return USDC_MAINNET;
    case SUI_TESTNET_CAIP2:
      return USDC_TESTNET;
    case SUI_DEVNET_CAIP2:
      return USDC_TESTNET;
    default:
      throw new Error(`No USDC coin type configured for network: ${network}`);
  }
}

/**
 * Validate a fully zero-padded Sui address format (0x + 64 hex chars).
 * Short-form addresses like "0x2" must be normalized to full-length first.
 *
 * @param address - Hex-encoded Sui address (0x + 64 hex chars)
 * @returns true if address matches the full-length format
 */
export function validateSuiAddress(address: string): boolean {
  return SUI_ADDRESS_REGEX.test(address);
}

/**
 * Convert a decimal amount string to token smallest units.
 * Uses pure string arithmetic — no floating-point intermediates.
 *
 * @param decimalAmount - The decimal amount (e.g., "0.10")
 * @param decimals - The number of decimals for the token (e.g., 6 for USDC)
 * @returns The amount in smallest units as a string
 */
export function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  const trimmed = decimalAmount.trim();
  if (trimmed.startsWith("-")) {
    throw new Error(`Negative amounts not allowed: ${decimalAmount}`);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${decimalAmount}`);
  }
  // Pure string-based conversion — no parseFloat to avoid precision loss
  const [intPart, decPart = ""] = trimmed.split(".");
  // Pad or truncate the decimal part to exactly `decimals` places
  const paddedDec = decPart.slice(0, decimals).padEnd(decimals, "0");
  const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
  return tokenAmount;
}

/**
 * Compare two Sui coin types for equality after normalization
 * Handles differences in leading zeros, casing, and formatting
 *
 * @param a - First coin type
 * @param b - Second coin type
 * @returns true if the coin types are equivalent
 */
export function coinTypesEqual(a: string, b: string): boolean {
  return normalizeStructTag(a) === normalizeStructTag(b);
}
