# @sweefi/vue

Vue 3 composable and plugin for the SweeFi s402 payment flow.

`@sweefi/vue` wraps `@sweefi/ui-core`'s `PaymentController` in a Vue-native API — a `useSweefiPayment()` composable that returns reactive state and pay/confirm/reset functions. Includes `SweefiPlugin` for app-level controller injection.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## Install

```bash
npm install @sweefi/vue @sweefi/sui @sweefi/ui-core
```

---

## Plugin mode (recommended for apps)

Install the plugin once at the app level and use the composable anywhere:

```typescript
// main.ts
import { createApp } from 'vue';
import { SweefiPlugin } from '@sweefi/vue';
import { SuiPaymentAdapter } from '@sweefi/sui';
import { createPaymentController } from '@sweefi/ui-core';

const adapter = new SuiPaymentAdapter({ wallet: currentWallet, client: suiClient, network: 'sui:testnet' });
const controller = createPaymentController(adapter);

createApp(App)
  .use(SweefiPlugin, controller)
  .mount('#app');
```

```vue
<!-- PayButton.vue -->
<script setup lang="ts">
import { useSweefiPayment } from '@sweefi/vue';

const { state, pay } = useSweefiPayment(); // controller injected from plugin
</script>

<template>
  <button :disabled="state.status !== 'idle'" @click="pay('https://api.example.com/premium', { requirements })">
    {{ state.status === 'idle' ? 'Pay' : state.status }}
  </button>
</template>
```

---

## Direct mode (pass controller explicitly)

```vue
<script setup lang="ts">
import { useSweefiPayment } from '@sweefi/vue';

const props = defineProps<{ controller: PaymentController }>();
const { state, pay, reset } = useSweefiPayment(props.controller);
</script>
```

---

## Composable API

```typescript
const { state, pay, confirm, reset } = useSweefiPayment(controller?);
```

| Return value | Type | Description |
|---|---|---|
| `state` | `Ref<PaymentState>` | Reactive current state |
| `pay(url, options?)` | function | Start a payment flow for the given URL |
| `confirm()` | function | Confirm a pending payment (if applicable) |
| `reset()` | function | Reset to `idle` state |

---

## Cleanup note

Subscriptions are cleaned up automatically via `onScopeDispose` (compatible with component `setup()`, Pinia stores, and `effectScope()`). Do not use `onUnmounted` for cleanup — it only fires inside component setup and will warn or leak in store contexts.

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core) | Framework-agnostic state machine + adapter interface |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Sui adapter + PTB builders + `createS402Client` |
| [`@sweefi/vue`](https://www.npmjs.com/package/@sweefi/vue) | This package |
| [`@sweefi/react`](https://www.npmjs.com/package/@sweefi/react) | React equivalent |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
