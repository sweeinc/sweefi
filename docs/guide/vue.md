# @sweefi/vue

Vue 3 plugin and composable wrapping `PaymentController` from `@sweefi/ui-core`.

## Install

```bash
pnpm add @sweefi/vue @sweefi/ui-core @sweefi/sui @mysten/sui
```

`vue` is a peer dependency (`^3.3.0`).

## Quick Example

```vue
<script setup lang="ts">
import { useSweefiPayment } from '@sweefi/vue';
import { createPaymentController } from '@sweefi/ui-core';
import { SuiPaymentAdapter } from '@sweefi/sui';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const adapter = new SuiPaymentAdapter({
  wallet: keypair,       // Ed25519Keypair or any Signer
  client: new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443' }),
  network: 'sui:testnet',
});
const controller = createPaymentController(adapter);

const { state, pay, reset } = useSweefiPayment(controller);
</script>

<template>
  <div>
    <p>Status: {{ state.status }}</p>
    <p v-if="state.txId">TX: {{ state.txId }}</p>
    <button
      @click="pay('https://api.example.com/premium')"
      :disabled="state.status !== 'idle'"
    >
      {{ state.status === 'idle' ? 'Pay' : state.status }}
    </button>
  </div>
</template>
```

## Plugin Setup

Register globally via the Vue plugin:

```typescript
import { createApp } from 'vue';
import { SweefiPlugin } from '@sweefi/vue';
import { createPaymentController } from '@sweefi/ui-core';

const controller = createPaymentController(adapter);
const app = createApp(App);

app.use(SweefiPlugin, controller);
app.mount('#app');
```

Then in any component:

```vue
<script setup lang="ts">
import { useSweefiPayment } from '@sweefi/vue';

// No controller arg needed — injected by plugin
const { state, pay, reset } = useSweefiPayment();
</script>
```

## API

### `SweefiPlugin`

Vue 3 plugin. Install with `app.use(SweefiPlugin, controller)`.

### `useSweefiPayment(controller?)`

Returns reactive payment state and actions.

```typescript
const {
  state,     // Ref<PaymentState> — Vue reactive ref
  pay,       // (url: string, options?) => Promise<void>
  confirm,   // () => Promise<{ txId: string }>
  reset,     // () => void
} = useSweefiPayment();
```

**Two usage modes:**

| Mode | How | When |
|------|-----|------|
| Plugin | `app.use(SweefiPlugin, ctrl)` + `useSweefiPayment()` | App-wide payment state |
| Direct | `useSweefiPayment(controller)` | Local scope, no plugin needed |

### `useSweefiController()`

Access the raw `PaymentController` from injection:

```typescript
const controller = useSweefiController(); // PaymentController (throws if no SweefiPlugin)
```

## Implementation Notes

- Uses `onScopeDispose` (not `onUnmounted`) for cleanup — works correctly in component `setup()`, Pinia stores, and `effectScope()`. `onUnmounted` would warn and leak when used outside a component.
- `state` is a Vue `Ref` — it's reactive and triggers template updates automatically.

## Next Steps

- [@sweefi/ui-core](/guide/ui-core) — State machine details
- [@sweefi/react](/guide/react) — React equivalent
- [@sweefi/sui](/guide/sui) — Sui adapter
