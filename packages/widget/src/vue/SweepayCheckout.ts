import { defineComponent, h, onMounted } from "vue";
import type { PropType } from "vue";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import type { SweepayConfig } from "@sweepay/sui/ptb";
import type { WalletAdapter } from "../core";
import { useSweepayCheckout } from "./useSweepayCheckout";

export const SweepayCheckout = defineComponent({
  name: "SweepayCheckout",
  props: {
    wallet: { type: Object as PropType<WalletAdapter>, required: true },
    recipient: { type: String, required: true },
    amount: { type: [String, Number] as PropType<string | number>, required: true },
    coinType: { type: String, default: "0x2::sui::SUI" },
    feeBps: { type: Number, default: 0 },
    feeRecipient: { type: String, default: undefined },
    memo: { type: String, default: undefined },
    suiClient: { type: Object as PropType<SuiClient>, default: undefined },
    network: { type: String as PropType<"testnet" | "mainnet" | "devnet">, default: "testnet" },
    config: { type: Object as PropType<SweepayConfig>, default: undefined },
    autoConnect: { type: Boolean, default: false },
  },
  emits: ["connected", "simulated", "paid", "error"],
  setup(props, { emit }) {
    const client =
      props.suiClient ??
      new SuiClient({
        url: getFullnodeUrl(props.network),
      });

    const checkout = useSweepayCheckout({
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
      h("div", { class: "sweepay-checkout" }, [
        h("p", `Status: ${checkout.state.value.status}`),
        checkout.state.value.address
          ? h("p", `Wallet: ${checkout.state.value.address}`)
          : h("p", "Wallet: not connected"),
        checkout.state.value.error ? h("p", `Error: ${checkout.state.value.error}`) : null,
        checkout.state.value.digest ? h("p", `Digest: ${checkout.state.value.digest}`) : null,
        h("div", { class: "sweepay-actions" }, [
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
