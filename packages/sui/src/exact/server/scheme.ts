import type {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@sweepay/core/types";
import { convertToTokenAmount, getUsdcCoinType } from "../../utils";
import { USDC_DECIMALS } from "../../constants";

/**
 * Sui server implementation for the Exact payment scheme.
 * Handles price parsing and payment requirements enhancement.
 */
export class ExactSuiScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   * Multiple parsers can be registered — they are tried in registration order.
   * Each parser receives a decimal amount (e.g., 1.50 for $1.50).
   * If a parser returns null, the next parser in the chain will be tried.
   * The default parser (USDC) is always the final fallback.
   *
   * @param parser - Custom function to convert amount to AssetAmount (or null to skip)
   * @returns The scheme instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): ExactSuiScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into an asset amount.
   * If price is already an AssetAmount, returns it directly.
   * If price is Money (string | number), parses to decimal and tries custom parsers.
   * Falls back to USDC conversion if all custom parsers return null.
   *
   * @param price - The price to parse
   * @param network - The CAIP-2 network identifier
   * @returns Promise resolving to the parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // If already an AssetAmount, return it directly
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra || {},
      };
    }

    // Parse Money to decimal number
    const amount = this.parseMoneyToDecimal(price);

    // Try each custom money parser in order
    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    // All custom parsers returned null, use default USDC conversion
    return this.defaultMoneyConversion(amount, network);
  }

  /**
   * Build payment requirements for this scheme/network combination.
   * For Sui, adds gasStation URL to extra when the facilitator supports sponsorship.
   *
   * @param paymentRequirements - The base payment requirements
   * @param supportedKind - The supported kind configuration from facilitator
   * @param supportedKind.x402Version - The x402 protocol version
   * @param supportedKind.scheme - The payment scheme
   * @param supportedKind.network - The network identifier
   * @param supportedKind.extra - Extra metadata (may include gasStation URL)
   * @param extensionKeys - Extension keys supported by the facilitator
   * @returns Enhanced payment requirements
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;

    // Pass through any facilitator extras (e.g., gasStation URL)
    return Promise.resolve({
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        ...supportedKind.extra,
      },
    });
  }

  /**
   * Parse Money (string | number) to a decimal number.
   * Handles formats like "$1.50", "1.50", "1.50 USDC", 1.50, etc.
   *
   * @param money - The money value to parse
   * @returns Decimal number
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }

    // Remove $ sign, currency suffixes, and whitespace
    const cleanMoney = money
      .replace(/^\$/, "")
      .replace(/\s*(USDC|USD|SUI)\s*$/i, "")
      .trim();
    const amount = parseFloat(cleanMoney);

    if (isNaN(amount)) {
      throw new Error(`Invalid money format: ${money}`);
    }

    return amount;
  }

  /**
   * Default money conversion — converts to USDC on the specified Sui network.
   *
   * @param amount - The decimal amount (e.g., 1.50)
   * @param network - The CAIP-2 network identifier
   * @returns AssetAmount in USDC
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const tokenAmount = convertToTokenAmount(amount.toString(), USDC_DECIMALS);
    return {
      amount: tokenAmount,
      asset: getUsdcCoinType(network),
      extra: {},
    };
  }
}
