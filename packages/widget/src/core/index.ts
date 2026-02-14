import { testnetConfig } from "@sweepay/sui/ptb";
import { SweepayCheckoutController } from "./controller";
import { SUI_COIN_TYPE, ZERO_ADDRESS } from "./constants";
import type { CheckoutControllerOptions, PaymentRequest } from "./types";

export type {
  WalletAdapter,
  CheckoutControllerOptions,
  CheckoutState,
  CheckoutStatus,
  PayResult,
  PaymentRequest,
} from "./types";

export { SweepayCheckoutController, SUI_COIN_TYPE, ZERO_ADDRESS };

export function createCheckoutController(options: CheckoutControllerOptions): SweepayCheckoutController {
  return new SweepayCheckoutController(options);
}

export function createDefaultPaymentRequest(input: {
  recipient: string;
  amount: bigint;
  coinType?: string;
  feeBps?: number;
  feeRecipient?: string;
  memo?: string;
}): PaymentRequest {
  return {
    recipient: input.recipient,
    amount: input.amount,
    coinType: input.coinType ?? SUI_COIN_TYPE,
    feeBps: input.feeBps ?? 0,
    feeRecipient: input.feeRecipient ?? ZERO_ADDRESS,
    memo: input.memo,
  };
}

export function createDefaultConfig() {
  return testnetConfig;
}
