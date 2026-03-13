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
  // idle → fetching_requirements → simulating → ready → awaiting_signature → broadcasting → settled | error
});

// 4. Trigger payment (fetches requirements from 402 response automatically)
await controller.pay('https://api.example.com/premium');
// Or provide requirements directly:
// await controller.pay('https://api.example.com/premium', { requirements: paymentRequirements });

// 5. Once state reaches "ready", confirm to sign and broadcast
await controller.confirm();

unsubscribe();
```

---

## State Machine

The `PaymentController` drives a deterministic state machine:

| Status | Meaning |
|--------|---------|
| `idle` | No payment in progress |
| `fetching_requirements` | GET request sent, awaiting 402 response with payment requirements |
| `simulating` | Dry-running the transaction to estimate gas |
| `ready` | Simulation passed — call `confirm()` to sign and broadcast |
| `awaiting_signature` | Waiting for wallet to sign the transaction |
| `broadcasting` | Signed transaction submitted to chain |
| `settled` | Payment confirmed on-chain, receipt available |
| `error` | Payment failed (error string available on state) |

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
  readonly network = 'mychain:mainnet';
  getAddress(): string | null { return '0x...'; }
  async simulate(reqs: s402PaymentRequirements): Promise<SimulationResult> { ... }
  async signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }> { ... }
}
```

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core) | This package — state machine + adapter interface |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Sui adapter + $extend() plugin + contract classes + `createS402Client` |
| [`@sweefi/vue`](https://www.npmjs.com/package/@sweefi/vue) | Vue 3 composable + plugin |
| [`@sweefi/react`](https://www.npmjs.com/package/@sweefi/react) | React hook + context provider |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
