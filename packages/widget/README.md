# @sweefi/widget

Framework-agnostic checkout core with Vue 3 and React adapters.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

## Entry Points

- `@sweefi/widget` or `@sweefi/widget/core` — framework-agnostic controller
- `@sweefi/widget/vue` — Vue composable + `SweefiCheckout` component
- `@sweefi/widget/react` — React hook + `SweefiCheckout` component

## Core (Framework-Agnostic)

```ts
import { createCheckoutController, createDefaultConfig } from "@sweefi/widget/core";

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
import { SweefiCheckout } from "@sweefi/widget/vue";
```

Use the component with `wallet`, `recipient`, and `amount` props, then handle `connected`, `simulated`, and `paid` events.

## React Adapter

```tsx
import { SweefiCheckout } from "@sweefi/widget/react";
```

Use the component with `wallet`, `recipient`, and `amount` props, then handle `onConnected`, `onSimulated`, and `onPaid` callbacks.

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
