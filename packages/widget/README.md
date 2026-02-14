# @sweepay/widget

Framework-agnostic checkout core with Vue 3 and React adapters.

## Entry Points

- `@sweepay/widget` or `@sweepay/widget/core` — framework-agnostic controller
- `@sweepay/widget/vue` — Vue composable + `SweepayCheckout` component
- `@sweepay/widget/react` — React hook + `SweepayCheckout` component

## Core (Framework-Agnostic)

```ts
import { createCheckoutController, createDefaultConfig } from "@sweepay/widget/core";

const controller = createCheckoutController({
  wallet,
  suiClient,
  config: createDefaultConfig(),
  payment: {
    recipient: "0x...",
    coinType: "0x2::sui::SUI",
    amount: 1_000_000n,
    feeBps: 0,
    feeRecipient: "0x" + "0".repeat(64),
  },
});

await controller.connectWallet();
await controller.simulatePayment();
const result = await controller.pay();
```

## Vue Adapter

```ts
import { SweepayCheckout } from "@sweepay/widget/vue";
```

Use the component with `wallet`, `recipient`, and `amount` props, then handle `connected`, `simulated`, and `paid` events.

## React Adapter

```tsx
import { SweepayCheckout } from "@sweepay/widget/react";
```

Use the component with `wallet`, `recipient`, and `amount` props, then handle `onConnected`, `onSimulated`, and `onPaid` callbacks.
