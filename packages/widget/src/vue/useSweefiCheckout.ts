import { computed, ref } from "vue";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { SweefiConfig } from "@sweefi/sui/ptb";
import {
  createCheckoutController,
  createDefaultConfig,
  createDefaultPaymentRequest,
  type WalletAdapter,
} from "../core";

export interface UseSweefiCheckoutOptions {
  wallet: WalletAdapter;
  suiClient: SuiJsonRpcClient;
  recipient: string;
  amount: bigint;
  coinType?: string;
  feeBps?: number;
  feeRecipient?: string;
  memo?: string;
  config?: SweefiConfig;
}

export function useSweefiCheckout(options: UseSweefiCheckoutOptions) {
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
