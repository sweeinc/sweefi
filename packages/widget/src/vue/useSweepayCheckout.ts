import { computed, ref } from "vue";
import type { SuiClient } from "@mysten/sui/client";
import type { SweepayConfig } from "@sweepay/sui/ptb";
import {
  createCheckoutController,
  createDefaultConfig,
  createDefaultPaymentRequest,
  type WalletAdapter,
} from "../core";

export interface UseSweepayCheckoutOptions {
  wallet: WalletAdapter;
  suiClient: SuiClient;
  recipient: string;
  amount: bigint;
  coinType?: string;
  feeBps?: number;
  feeRecipient?: string;
  memo?: string;
  config?: SweepayConfig;
}

export function useSweepayCheckout(options: UseSweepayCheckoutOptions) {
  const controller = createCheckoutController({
    wallet: options.wallet,
    suiClient: options.suiClient,
    config: options.config ?? createDefaultConfig(),
    payment: createDefaultPaymentRequest({
      recipient: options.recipient,
      amount: options.amount,
      coinType: options.coinType,
      feeBps: options.feeBps,
      feeRecipient: options.feeRecipient,
      memo: options.memo,
    }),
  });

  const state = ref(controller.getState());

  const syncState = () => {
    state.value = controller.getState();
  };

  return {
    state,
    digest: computed(() => state.value.digest),
    error: computed(() => state.value.error),
    isReadyToPay: computed(() => state.value.status === "ready" || state.value.status === "connected"),
    connectWallet: async () => {
      try {
        const address = await controller.connectWallet();
        return address;
      } finally {
        syncState();
      }
    },
    simulate: async () => {
      try {
        await controller.simulatePayment();
      } finally {
        syncState();
      }
    },
    pay: async () => {
      try {
        const result = await controller.pay();
        return result;
      } finally {
        syncState();
      }
    },
  };
}
