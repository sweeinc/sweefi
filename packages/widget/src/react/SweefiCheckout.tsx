import React, { useMemo } from "react";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { SweefiConfig } from "@sweefi/sui/ptb";
import type { WalletAdapter } from "../core";
import { useSweefiCheckout } from "./useSweefiCheckout";

export interface SweefiCheckoutProps {
  wallet: WalletAdapter;
  recipient: string;
  amount: bigint | number | string;
  coinType?: string;
  feeBps?: number;
  feeRecipient?: string;
  memo?: string;
  suiClient?: SuiJsonRpcClient;
  network?: "testnet" | "mainnet" | "devnet";
  config?: SweefiConfig;
  autoConnect?: boolean;
  onConnected?: (payload: { address: string }) => void;
  onSimulated?: () => void;
  onPaid?: (payload: { digest: string; receiptId: string | null }) => void;
  onError?: (error: unknown) => void;
}

export function SweefiCheckout(props: SweefiCheckoutProps) {
  const client = useMemo(
    () =>
      props.suiClient ??
      new SuiJsonRpcClient({
        url: getJsonRpcFullnodeUrl((props.network ?? "testnet") as 'testnet' | 'mainnet' | 'devnet'),
        network: props.network ?? "testnet",
      }),
    [props.suiClient, props.network],
  );

  const checkout = useSweefiCheckout({
    wallet: props.wallet,
    suiClient: client,
    recipient: props.recipient,
    amount: BigInt(props.amount),
    coinType: props.coinType,
    feeBps: props.feeBps,
    feeRecipient: props.feeRecipient,
    memo: props.memo,
    config: props.config,
  });

  React.useEffect(() => {
    if (!props.autoConnect) return;
    checkout
      .connectWallet()
      .then((address) => props.onConnected?.({ address }))
      .catch((error) => props.onError?.(error));
  }, []);

  return (
    <div className="sweefi-checkout">
      <p>Status: {checkout.state.status}</p>
      <p>Wallet: {checkout.state.address ?? "not connected"}</p>
      {checkout.state.error ? <p>Error: {checkout.state.error}</p> : null}
      {checkout.state.digest ? <p>Digest: {checkout.state.digest}</p> : null}

      <div className="sweefi-actions">
        <button
          type="button"
          onClick={() =>
            checkout
              .connectWallet()
              .then((address) => props.onConnected?.({ address }))
              .catch((error) => props.onError?.(error))
          }
          disabled={checkout.state.status === "connecting" || checkout.state.status === "paying"}
        >
          Connect Wallet
        </button>

        <button
          type="button"
          onClick={() =>
            checkout
              .simulate()
              .then(() => props.onSimulated?.())
              .catch((error) => props.onError?.(error))
          }
          disabled={!checkout.state.address || checkout.state.status === "simulating"}
        >
          Simulate
        </button>

        <button
          type="button"
          onClick={() =>
            checkout
              .pay()
              .then((result) => props.onPaid?.(result))
              .catch((error) => props.onError?.(error))
          }
          disabled={
            !(checkout.state.status === "ready" || checkout.state.status === "connected")
          }
        >
          Pay
        </button>
      </div>
    </div>
  );
}
