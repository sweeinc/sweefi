# @sweefi/ui-core

Framework-agnostic payment state machine and `PaymentAdapter` interface for SweeFi.

`@sweefi/ui-core` defines the `PaymentController` state machine and `PaymentAdapter` interface that framework-specific packages (`@sweefi/vue`, `@sweefi/react`) build on. It has no blockchain or framework dependencies — it is the glue between chain adapters and UI bindings.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## Install

```bash
npm install @sweefi/ui-core
```

For a complete Sui implementation, install `@sweefi/sui` which provides the `SuiPaymentAdapter`.

---

## Usage

```typescript
import { createPaymentController } from '@sweefi/ui-core';
import { SuiPaymentAdapter } from '@sweefi/sui';

// 1. Create a chain adapter
const adapter = new SuiPaymentAdapter({ wallet: currentWallet, client: suiClient, network: 'sui:testnet' });

// 2. Create a controller
const controller = createPaymentController(adapter);

// 3. Subscribe to state changes
const unsubscribe = controller.subscribe((state) => {
  console.log('Payment state:', state.status);
  // idle → awaiting_signature → broadcasting → settled | failed
});

// 4. Trigger payment
await controller.pay({
  url: 'https://api.example.com/premium',
  requirements: paymentRequirements,
});

unsubscribe();
```

---

## State Machine

The `PaymentController` drives a deterministic state machine:

| Status | Meaning |
|--------|---------|
| `idle` | No payment in progress |
| `awaiting_signature` | Waiting for wallet to sign the transaction |
| `broadcasting` | Signed transaction submitted to chain |
| `settled` | Payment confirmed on-chain, receipt available |
| `failed` | Payment failed (error available on state) |

---

## Key exports

| Export | Type | Purpose |
|--------|------|---------|
| `createPaymentController` | function | Create a new controller from an adapter |
| `PaymentController` | class | The state machine |
| `PaymentAdapter` | interface | Implement to add a new chain |
| `PaymentState` | type | Current controller state |
| `PaymentStatus` | type | Status union literal |

---

## Implementing a custom adapter

```typescript
import type { PaymentAdapter, SimulationResult } from '@sweefi/ui-core';

class MyChainAdapter implements PaymentAdapter {
  async simulate(requirements): Promise<SimulationResult> { ... }
  async signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }> { ... }
}
```

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core) | This package — state machine + adapter interface |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Sui adapter + 40 PTB builders + `createS402Client` |
| [`@sweefi/vue`](https://www.npmjs.com/package/@sweefi/vue) | Vue 3 composable + plugin |
| [`@sweefi/react`](https://www.npmjs.com/package/@sweefi/react) | React hook + context provider |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
