# @sweefi/react

React hook and context provider wrapping `PaymentController` from `@sweefi/ui-core`.

## Install

```bash
pnpm add @sweefi/react @sweefi/ui-core @sweefi/sui @mysten/sui
```

`react` is a peer dependency (`^18.0.0 || ^19.0.0`).

## Quick Example

```tsx
import { SweefiProvider, useSweefiPayment } from '@sweefi/react';
import { createPaymentController } from '@sweefi/ui-core';
import { SuiPaymentAdapter, toClientSuiSigner } from '@sweefi/sui';

// Create controller once (outside component)
const adapter = new SuiPaymentAdapter({
  signer: toClientSuiSigner(keypair, suiClient),
  network: 'sui:testnet',
});
const controller = createPaymentController(adapter);

function App() {
  return (
    <SweefiProvider controller={controller}>
      <PayButton />
    </SweefiProvider>
  );
}

function PayButton() {
  const { state, pay, reset } = useSweefiPayment();

  if (state.status === 'settled') {
    return <p>Paid! TX: {state.txId}</p>;
  }

  return (
    <button
      onClick={() => pay('https://api.example.com/premium')}
      disabled={state.status !== 'idle'}
    >
      {state.status === 'idle' ? 'Pay' : state.status}
    </button>
  );
}
```

## API

### `SweefiProvider`

Context provider that makes the `PaymentController` available to child components.

```tsx
<SweefiProvider controller={controller}>
  {children}
</SweefiProvider>
```

### `useSweefiPayment(controller?)`

Returns reactive payment state and actions.

```typescript
const {
  state,     // PaymentState — reactive via useSyncExternalStore
  pay,       // (url: string, options?) => Promise<void>
  confirm,   // () => Promise<{ txId: string }>
  reset,     // () => void
} = useSweefiPayment();
```

**Two usage modes:**

| Mode | How | When |
|------|-----|------|
| Provider | `<SweefiProvider>` + `useSweefiPayment()` | Multiple components need payment state |
| Direct | `useSweefiPayment(controller)` | Single component, no provider needed |

### `useSweefiController()`

Access the raw `PaymentController` from context:

```typescript
const controller = useSweefiController(); // PaymentController | null
```

## Implementation Notes

The hook uses React's `useSyncExternalStore` for tear-free reads of the controller state. The `getState()` method returns a new object on each call (`{ ...this.state }`), so the hook caches the snapshot in a `useRef` to prevent infinite re-renders. Do not remove this caching.

## Next Steps

- [@sweefi/ui-core](/guide/ui-core) — State machine details
- [@sweefi/vue](/guide/vue) — Vue equivalent
- [@sweefi/sui](/guide/sui) — Sui adapter
