# @sweefi/react

React hook and context provider for the SweeFi s402 payment flow.

`@sweefi/react` wraps `@sweefi/ui-core`'s `PaymentController` in a React-native API — a `useSweefiPayment()` hook that uses `useSyncExternalStore` for tear-free concurrent-mode rendering. Includes a `SweefiProvider` context for tree-wide controller sharing.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## Install

```bash
npm install @sweefi/react @sweefi/sui @sweefi/ui-core
```

---

## Provider mode (recommended for apps)

Wrap your tree with `SweefiProvider` and use the hook anywhere below it:

```tsx
// App.tsx
import { SweefiProvider } from '@sweefi/react';
import { SuiPaymentAdapter } from '@sweefi/sui';
import { createPaymentController } from '@sweefi/ui-core';

const adapter = new SuiPaymentAdapter({ wallet: currentWallet, client: suiClient, network: 'sui:testnet' });
const controller = createPaymentController(adapter);

export function App() {
  return (
    <SweefiProvider controller={controller}>
      <YourApp />
    </SweefiProvider>
  );
}
```

```tsx
// PayButton.tsx
import { useSweefiPayment } from '@sweefi/react';

export function PayButton({ requirements }) {
  const { state, pay } = useSweefiPayment(); // controller from context

  return (
    <button disabled={state.status !== 'idle'} onClick={() => pay('https://api.example.com/premium', { requirements })}>
      {state.status === 'idle' ? 'Pay' : state.status}
    </button>
  );
}
```

---

## Direct mode (pass controller explicitly)

```tsx
import { useSweefiPayment } from '@sweefi/react';

function PayButton({ controller, requirements }) {
  const { state, pay, reset } = useSweefiPayment(controller);
  // ...
}
```

---

## Hook API

```typescript
const { state, pay, confirm, reset } = useSweefiPayment(controller?);
```

| Return value | Type | Description |
|---|---|---|
| `state` | `PaymentState` | Current state (snapshot, concurrent-mode safe) |
| `pay(url, options?)` | function | Start a payment flow for the given URL |
| `confirm()` | function | Confirm a pending payment (if applicable) |
| `reset()` | function | Reset to `idle` state |

The hook uses `useSyncExternalStore` internally for optimal concurrent-mode behavior. The snapshot reference is cached in a `useRef` to avoid infinite re-renders — do not remove this pattern when modifying the hook.

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core) | Framework-agnostic state machine + adapter interface |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Sui adapter + PTB builders + `createS402Client` |
| [`@sweefi/vue`](https://www.npmjs.com/package/@sweefi/vue) | Vue 3 equivalent |
| [`@sweefi/react`](https://www.npmjs.com/package/@sweefi/react) | This package |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
