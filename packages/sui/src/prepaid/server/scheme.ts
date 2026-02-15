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
 * Sui server implementation for the Prepaid payment scheme.
 * Handles price parsing and payment requirements enhancement.
 *
 * For prepaid, the "price" represents the minimum deposit amount.
 * The server also advertises ratePerCall, maxCalls, and withdrawalDelayMs
 * so the client knows how to configure the PrepaidBalance.
 */
export class PrepaidSuiScheme implements SchemeNetworkServer {
  readonly scheme = "prepaid";
  private moneyParsers: MoneyParser[] = [];

  constructor(
    private readonly prepaidConfig: PrepaidServerConfig,
  ) {}

  registerMoneyParser(parser: MoneyParser): PrepaidSuiScheme {
    this.moneyParsers.push(parser);
    return this;
  }

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

    const amount = this.parseMoneyToDecimal(price);

    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    return this.defaultMoneyConversion(amount, network);
  }

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

    // Add prepaid-specific config to requirements.extra
    return Promise.resolve({
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        ...supportedKind.extra,
        // Prepaid-specific fields
        ratePerCall: this.prepaidConfig.ratePerCall,
        maxCalls: this.prepaidConfig.maxCalls,
        minDeposit: this.prepaidConfig.minDeposit,
        withdrawalDelayMs: this.prepaidConfig.withdrawalDelayMs,
      },
    });
  }

  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") return money;
    const cleanMoney = money
      .replace(/^\$/, "")
      .replace(/\s*(USDC|USD|SUI)\s*$/i, "")
      .trim();
    const amount = parseFloat(cleanMoney);
    if (isNaN(amount)) throw new Error(`Invalid money format: ${money}`);
    return amount;
  }

  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const tokenAmount = convertToTokenAmount(amount.toString(), USDC_DECIMALS);
    return {
      amount: tokenAmount,
      asset: getUsdcCoinType(network),
      extra: {},
    };
  }
}

/** Configuration for prepaid server scheme */
export interface PrepaidServerConfig {
  /** Maximum base units per API call (rate cap) */
  ratePerCall: string;
  /** Max calls cap. Omit for unlimited. */
  maxCalls?: string;
  /** Minimum deposit amount in base units */
  minDeposit: string;
  /** Withdrawal delay in ms */
  withdrawalDelayMs: string;
}
