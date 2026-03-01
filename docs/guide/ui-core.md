# @sweefi/ui-core

Framework-agnostic payment state machine. Zero blockchain or framework dependencies. This package defines the `PaymentController` and `PaymentAdapter` interface that `@sweefi/react` and `@sweefi/vue` wrap.

## Install

```bash
pnpm add @sweefi/ui-core
```

## Architecture

```
@sweefi/ui-core         @sweefi/sui           @sweefi/vue / @sweefi/react
─────────────────       ─────────────         ──────────────────────────
PaymentController  ←──  SuiPaymentAdapter  ──→  useSweefiPayment()
PaymentAdapter     ←──  (implements)       ──→  SweefiPlugin / SweefiProvider
```

`ui-core` owns the state machine. Chain-specific packages implement `PaymentAdapter`. Framework packages provide reactive bindings.

## PaymentController

Manages the entire payment lifecycle as a deterministic state machine.

```typescript
import { createPaymentController, PaymentController } from '@sweefi/ui-core';

const controller = createPaymentController(adapter);

// Subscribe to state changes
const unsub = controller.subscribe((state) => {
  console.log(state.status); // 'idle' → 'fetching_requirements' → ... → 'settled'
});

// Start a payment
await controller.pay('https://api.example.com/premium');

// Or confirm manually (if status is 'ready')
const { txId } = await controller.confirm();

// Reset to idle
controller.reset();
```

### State Machine

```
idle
  │
  ▼  pay(url)
fetching_requirements
  │
  ▼  requirements received
simulating
  │
  ▼  simulation passed
ready
  │
  ▼  confirm() or auto-confirm
awaiting_signature
  │
  ▼  signed
broadcasting        ← MUST be set BEFORE the await
  │
  ▼  TX confirmed
settled
```

Any state can transition to `error` on failure.

### PaymentState

```typescript
interface PaymentState {
  status: PaymentStatus;
  address: string | null;
  requirements: s402PaymentRequirements | null;
  simulation: SimulationResult | null;
  txId: string | null;
  error: string | null;
}

type PaymentStatus =
  | 'idle'
  | 'fetching_requirements'
  | 'simulating'
  | 'ready'
  | 'awaiting_signature'
  | 'broadcasting'
  | 'settled'
  | 'error';
```

## PaymentAdapter Interface

Implement this to add a new chain:

```typescript
interface PaymentAdapter {
  network: string;  // CAIP-2: 'sui:mainnet', 'solana:mainnet-beta'

  getAddress(): string | null;

  simulate(
    reqs: s402PaymentRequirements
  ): Promise<SimulationResult>;

  signAndBroadcast(
    reqs: s402PaymentRequirements
  ): Promise<{ txId: string }>;
}
```

### SimulationResult

```typescript
interface SimulationResult {
  success: boolean;
  estimatedFee?: { amount: bigint; currency: string };
  error?: { code: string; message: string };
  ataCreationRequired?: boolean;      // Solana-specific
  ataCreationCostLamports?: bigint;   // Solana-specific
}
```

### Existing Adapters

| Package | Adapter | Network |
|---------|---------|---------|
| `@sweefi/sui` | `SuiPaymentAdapter` | `sui:testnet`, `sui:mainnet` |
| `@sweefi/solana` | `SolanaPaymentAdapter` | `solana:devnet`, `solana:mainnet-beta` |

Adding a new chain (e.g., Aptos) means implementing `PaymentAdapter` — no changes to `ui-core`, `vue`, or `react`.

## Usage Without a Framework

You can use `PaymentController` directly in vanilla JavaScript:

```typescript
import { createPaymentController } from '@sweefi/ui-core';
import { SuiPaymentAdapter } from '@sweefi/sui';

const adapter = new SuiPaymentAdapter({ /* ... */ });
const controller = createPaymentController(adapter);

controller.subscribe((state) => {
  document.getElementById('status')!.textContent = state.status;
  if (state.txId) {
    document.getElementById('txId')!.textContent = state.txId;
  }
});

document.getElementById('payBtn')!.onclick = () => {
  controller.pay('https://api.example.com/premium');
};
```

## Next Steps

- [@sweefi/react](/guide/react) — React bindings
- [@sweefi/vue](/guide/vue) — Vue bindings
- [@sweefi/sui](/guide/sui) — `SuiPaymentAdapter` implementation
