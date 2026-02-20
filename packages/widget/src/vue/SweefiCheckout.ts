import { defineComponent, h, onMounted } from "vue";
import type { PropType } from "vue";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { SweefiConfig } from "@sweefi/sui/ptb";
import type { WalletAdapter } from "../core";
import { useSweefiCheckout } from "./useSweefiCheckout";

export const SweefiCheckout = defineComponent({
  name: "SweefiCheckout",
  props: {
    wallet: { type: Object as PropType<WalletAdapter>, required: true },
    recipient: { type: String, required: true },
    amount: { type: [String, Number] as PropType<string | number>, required: true },
    coinType: { type: String, default: "0x2::sui::SUI" },
    feeBps: { type: Number, default: 0 },
    feeRecipient: { type: String, default: undefined },
    memo: { type: String, default: undefined },
    suiClient: { type: Object as PropType<SuiJsonRpcClient>, default: undefined },
    network: { type: String as PropType<"testnet" | "mainnet" | "devnet">, default: "testnet" },
    config: { type: Object as PropType<SweefiConfig>, default: undefined },
    autoConnect: { type: Boolean, default: false },
  },
  emits: ["connected", "simulated", "paid", "error"],
  setup(props, { emit }) {
    const client =
      props.suiClient ??
      new SuiJsonRpcClient({
        url: getJsonRpcFullnodeUrl(props.network as 'testnet' | 'mainnet' | 'devnet'),
        network: props.network,
      });

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

    const onConnect = async () => {
      try {
        const address = await checkout.connectWallet();
        emit("connected", { address });
      } catch (error) {
        emit("error", error);
      }
    };

    const onSimulate = async () => {
      try {
        await checkout.simulate();
        emit("simulated");
      } catch (error) {
        emit("error", error);
      }
    };

    const onPay = async () => {
      try {
        const result = await checkout.pay();
        emit("paid", result);
      } catch (error) {
        emit("error", error);
      }
    };

    onMounted(async () => {
      if (!props.autoConnect) return;
      try {
        const address = await checkout.connectWallet();
        emit("connected", { address });
      } catch (error) {
        emit("error", error);
      }
    });

    return () =>
      h("div", { class: "sweefi-checkout" }, [
        h("p", `Status: ${checkout.state.value.status}`),
        checkout.state.value.address
          ? h("p", `Wallet: ${checkout.state.value.address}`)
          : h("p", "Wallet: not connected"),
        checkout.state.value.error ? h("p", `Error: ${checkout.state.value.error}`) : null,
        checkout.state.value.digest ? h("p", `Digest: ${checkout.state.value.digest}`) : null,
        h("div", { class: "sweefi-actions" }, [
          h(
            "button",
            {
              type: "button",
              onClick: onConnect,
              disabled: checkout.state.value.status === "connecting" || checkout.state.value.status === "paying",
            },
            "Connect Wallet",
          ),
          h(
            "button",
            {
              type: "button",
              onClick: onSimulate,
              disabled: !checkout.state.value.address || checkout.state.value.status === "simulating",
            },
            "Simulate",
          ),
          h(
            "button",
            {
              type: "button",
              onClick: onPay,
              disabled: !checkout.isReadyToPay.value || checkout.state.value.status === "paying",
            },
            "Pay",
          ),
        ]),
      ]);
  },
});
