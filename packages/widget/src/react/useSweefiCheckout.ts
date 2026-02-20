import { useMemo, useState } from "react";
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
  const controller = useMemo(
    () =>
      createCheckoutController({
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
      }),
    [
      options.wallet,
      options.suiClient,
      options.config,
      options.recipient,
      options.amount,
      options.coinType,
      options.feeBps,
      options.feeRecipient,
      options.memo,
    ],
  );

  const [state, setState] = useState(controller.getState());
  const sync = () => setState(controller.getState());

  return {
    state,
    connectWallet: async () => {
      try {
        return await controller.connectWallet();
      } finally {
        sync();
      }
    },
    simulate: async () => {
      try {
        await controller.simulatePayment();
      } finally {
        sync();
      }
    },
    pay: async () => {
      try {
        return await controller.pay();
      } finally {
        sync();
      }
    },
  };
}
