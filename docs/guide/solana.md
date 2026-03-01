# @sweefi/solana

Solana adapter for s402. Enables SweeFi's payment protocol on Solana with exact scheme support (SPL tokens + native SOL).

## Install

```bash
pnpm add @sweefi/solana @solana/web3.js
```

## Multi-Chain Story

SweeFi is Sui-first but chain-agnostic by design. `@sweefi/solana` implements the same `PaymentAdapter` interface as `@sweefi/sui`, so it works with `PaymentController` from `@sweefi/ui-core` and the Vue/React bindings without modification.

| Chain | Package | Schemes |
|-------|---------|---------|
| **Sui** | `@sweefi/sui` | Exact, Prepaid, Streaming, Escrow, SEAL |
| **Solana** | `@sweefi/solana` | Exact |

Sui has full scheme coverage because the Move smart contracts live on Sui. Solana supports exact transfers using native SPL token instructions.

## Quick Example

```typescript
import { SolanaPaymentAdapter, SolanaKeypairSigner, createSolanaConnection } from '@sweefi/solana';
import { Keypair } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(mySecretKey);
const signer = new SolanaKeypairSigner(keypair);

const adapter = new SolanaPaymentAdapter({
  wallet: signer,
  connection: createSolanaConnection('solana:devnet'),
  network: 'solana:devnet',
});

// Use with PaymentController
import { createPaymentController } from '@sweefi/ui-core';
const controller = createPaymentController(adapter);
```

## Signers

### `SolanaKeypairSigner`

For server-side or CLI usage with a raw keypair:

```typescript
import { SolanaKeypairSigner } from '@sweefi/solana';
import { Keypair } from '@solana/web3.js';

const signer = new SolanaKeypairSigner(Keypair.fromSecretKey(key));
signer.address; // base58 address
```

### `SolanaWalletSigner`

For browser usage with wallet adapters (Phantom, Backpack, etc.):

```typescript
import { SolanaWalletSigner } from '@sweefi/solana';

const signer = new SolanaWalletSigner(walletAdapter);
```

## SolanaPaymentAdapter

Implements `PaymentAdapter` from `@sweefi/ui-core`:

```typescript
import { Connection, clusterApiUrl } from '@solana/web3.js';

const adapter = new SolanaPaymentAdapter({
  wallet: signer,
  connection: new Connection(clusterApiUrl('devnet'), 'confirmed'),
  network: 'solana:devnet',    // or 'solana:mainnet-beta'
});

adapter.getAddress();                // base58 address
adapter.simulate(requirements);      // simulation with ATA detection
adapter.signAndBroadcast(requirements); // sign + send
```

The simulation result includes Solana-specific fields for Associated Token Account (ATA) creation:

```typescript
interface SimulationResult {
  success: boolean;
  estimatedFee?: { amount: bigint; currency: string };
  ataCreationRequired?: boolean;
  ataCreationCostLamports?: bigint;
}
```

## s402 Scheme Classes

| Class | Side | Description |
|-------|------|-------------|
| `ExactSolanaClientScheme` | Client | Build + sign exact payment |
| `ExactSolanaFacilitatorScheme` | Facilitator | Verify + broadcast |
| `ExactSolanaServerScheme` | Server | Validate payment proof |

## Constants

```typescript
import {
  SOLANA_MAINNET_CAIP2,    // 'solana:mainnet-beta'
  SOLANA_DEVNET_CAIP2,     // 'solana:devnet'
  SOLANA_TESTNET_CAIP2,    // 'solana:testnet'
  NATIVE_SOL_MINT,         // 'So111...1112'
  USDC_MAINNET_MINT,
  USDC_DEVNET_MINT,
  USDC_DECIMALS,           // 6
  SOL_DECIMALS,            // 9
  LAMPORTS_PER_SOL,        // 1_000_000_000
  BASE_FEE_LAMPORTS,       // 5_000n
} from '@sweefi/solana';
```

## Utilities

| Function | Description |
|----------|-------------|
| `createSolanaConnection(network, rpcUrl?)` | Create RPC `Connection` |
| `networkToCluster(network)` | CAIP-2 → cluster name |
| `getDefaultUsdcMint(network)` | Get USDC mint for network |
| `uint8ArrayToBase64(arr)` | Browser-safe base64 encoding |
| `base64ToUint8Array(str)` | Browser-safe base64 decoding |

## Next Steps

- [@sweefi/sui](/guide/sui) — Sui adapter (full scheme coverage)
- [@sweefi/ui-core](/guide/ui-core) — PaymentAdapter interface
- [Exact Payments](/guide/exact) — How exact scheme works
