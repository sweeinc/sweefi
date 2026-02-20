# @sweefi/core

> **Merged into `@sweefi/sdk`.** This package is an internal workspace dependency — it is not published to npm. All exports are available from `@sweefi/sdk`.

Shared types, client factories, and error hierarchy for the SweeFi ecosystem.

`@sweefi/core` was the foundation layer consumed by every SweeFi package. It has been merged into `@sweefi/sdk` to simplify the package surface. If you are building on top of SweeFi — whether an agent, a UI, or a custom integration — import from `@sweefi/sdk` instead.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

## Installation

```bash
npm install @sweefi/core
```

`@mysten/sui` is a peer dependency. Install it alongside:

```bash
npm install @sweefi/core @mysten/sui
```

## Quick Start

### Coin type constants

```typescript
import { COIN_TYPES, TESTNET_COIN_TYPES, COIN_DECIMALS } from '@sweefi/core';

// Mainnet
console.log(COIN_TYPES.SUI);   // '0x2::sui::SUI'
console.log(COIN_TYPES.USDC);  // Circle native USDC on mainnet
console.log(COIN_TYPES.USDT);  // Wormhole-bridged USDT on mainnet

// Testnet (USDC has a different package ID from mainnet)
console.log(TESTNET_COIN_TYPES.USDC);

// Decimal precision
const decimals = COIN_DECIMALS[COIN_TYPES.SUI]; // 9
```

### Create a Sui client

```typescript
import { createSuiClient } from '@sweefi/core';

const suiClient = createSuiClient('testnet');
// Returns a configured @mysten/sui SuiClient (JSON-RPC)
```

### Create a SEAL client

```typescript
import { createSuiClient, createSealClient } from '@sweefi/core';

const suiClient = createSuiClient('testnet');
const sealClient = await createSealClient(suiClient, 'testnet');

// sealClient.keyStore   — KeyStore instance from @mysten/seal
// sealClient.keyServers — resolved key server list
// sealClient.threshold  — majority threshold for decryption
```

SEAL key servers are only available on `testnet` and `mainnet`. On `devnet` or `localnet`, `createSealClient` returns an empty key server list with threshold 0.

### Create a Walrus client

```typescript
import { createSuiClient, createWalrusClient } from '@sweefi/core';

const suiClient = createSuiClient('testnet');
const walrusClient = await createWalrusClient('testnet', suiClient);
```

`@mysten/walrus` is loaded via dynamic import to avoid breaking consumers who do not use Walrus.

### Branded address types

```typescript
import { toSuiAddress, toObjectId, isValidSuiAddress } from '@sweefi/core';
import type { SuiAddress, ObjectId } from '@sweefi/core';

// Validate and brand — throws if the string is not a valid 0x-prefixed hex address
const sender: SuiAddress = toSuiAddress('0xb0b...');
const objectId: ObjectId = toObjectId('0xabc...');

// Non-throwing check
if (isValidSuiAddress(rawString)) { ... }
```

Branded types prevent passing raw strings where validated addresses are expected. Both `SuiAddress` and `ObjectId` are plain strings at runtime — the branding exists only in the type system.

### Error handling

```typescript
import { SweeError, SweeErrorCode } from '@sweefi/core';

try {
  // ...
} catch (err) {
  if (err instanceof SweeError) {
    switch (err.code) {
      case SweeErrorCode.INSUFFICIENT_BALANCE:
        // handle
        break;
      case SweeErrorCode.SEAL_ACCESS_DENIED:
        // handle
        break;
      default:
        throw err;
    }
  }
}

// Throwing with a cause
throw new SweeError(
  SweeErrorCode.NETWORK_ERROR,
  'RPC call failed',
  originalError,
);
```

### Message envelopes

```typescript
import { createMessageEnvelope } from '@sweefi/core';
import type { MessageEnvelope, MessageType } from '@sweefi/core';

const envelope: MessageEnvelope = createMessageEnvelope({
  type: 'task',
  sender: '0xb0b...',
  content: 'Transfer 0.5 SUI to 0xalice...',
  payload: { amount: 500_000_000, recipient: '0xalice...' },
  correlationId: 'req-001',
});
// version: 1 and timestamp are filled automatically
```

`MessageEnvelope` is the on-wire protocol shared by SealChat (renders `content`) and SuiAgent (reads `payload`). Both ignore unknown fields for forward compatibility.

### Custom logger

```typescript
import { defaultLogger } from '@sweefi/core';
import type { SweeLogger } from '@sweefi/core';

// Drop-in replacement — wire in Pino, Winston, or your own
const myLogger: SweeLogger = {
  debug(message, context) { pino.debug({ ...context }, message); },
  info(message, context)  { pino.info({ ...context }, message); },
  warn(message, context)  { pino.warn({ ...context }, message); },
  error(message, err, context) { pino.error({ err, ...context }, message); },
};
```

### Feature flags

```typescript
import { FeatureFlags } from '@sweefi/core';

if (FeatureFlags.SEAL_ENCRYPTION) {
  // SEAL encryption codepath enabled
}
```

Flags are read from environment variables at access time:

| Flag | Env variable | Default |
|------|-------------|---------|
| `SEAL_ENCRYPTION` | `SWEE_SEAL_ENCRYPTION` | `true` |
| `SEAL_POLICY_EVALUATION` | `SWEE_SEAL_POLICY_EVALUATION` | `true` |
| `SUI_STACK_MESSAGING` | `SWEE_SUI_STACK_MESSAGING` | `false` |
| `NAUTILUS_TEE` | `SWEE_NAUTILUS_TEE` | `false` |
| `ATOMA_INFERENCE` | `SWEE_ATOMA_INFERENCE` | `false` |

## Subpath Exports

### `@sweefi/core/s402`

```typescript
import { ... } from '@sweefi/core/s402';
```

Re-exports the `s402` package (Sui-native HTTP 402 wire format) for backward compatibility.

> **Deprecated.** Import directly from `s402` instead. This subpath will be removed in a future major version.

## API Reference

### Types

| Export | Description |
|--------|-------------|
| `SuiNetwork` | `'mainnet' \| 'testnet' \| 'devnet' \| 'localnet'` |
| `NetworkConfig` | Full network config: RPC URL, SEAL key servers, Walrus URLs |
| `SealKeyServerConfig` | `{ objectId: string; weight: number }` |
| `SuiAddress` | Branded string — validated 0x-prefixed Sui address (32-byte hex) |
| `ObjectId` | Branded string — validated 0x-prefixed Sui object ID (32-byte hex) |
| `CoinType` | Union of known mainnet coin type strings |
| `MessageEnvelope` | On-wire message format for SealChat / SuiAgent |
| `MessageType` | `'text' \| 'task' \| 'approval_request' \| 'result' \| 'status' \| 'system' \| 'coordination'` |
| `SweeSealClient` | `{ keyStore, keyServers, threshold, network }` |
| `CreateSealClientOptions` | Options for `createSealClient` |
| `WalrusNetwork` | `'mainnet' \| 'testnet'` |
| `SweeLogger` | Logger interface (`debug / info / warn / error`) |

### Constants

| Export | Description |
|--------|-------------|
| `COIN_TYPES` | Mainnet Move type strings for SUI, USDC, USDT |
| `TESTNET_COIN_TYPES` | Testnet Move type strings for SUI, USDC |
| `COIN_DECIMALS` | Decimal precision map indexed by coin type string |
| `NETWORKS` | Pre-configured `NetworkConfig` for all four networks |

### Client Factories

| Export | Signature | Description |
|--------|-----------|-------------|
| `createSuiClient` | `(network: SuiNetwork) => SuiClient` | JSON-RPC Sui client |
| `createSealClient` | `(suiClient, network, options?) => Promise<SweeSealClient>` | SEAL KeyStore + resolved key servers |
| `createWalrusClient` | `(network: WalrusNetwork, suiClient) => Promise<WalrusClient>` | Walrus blob storage client (lazy import) |

### Address Utilities

| Export | Signature | Description |
|--------|-----------|-------------|
| `toSuiAddress` | `(address: string) => SuiAddress` | Validate and brand as `SuiAddress`; throws on invalid |
| `toObjectId` | `(id: string) => ObjectId` | Validate and brand as `ObjectId`; throws on invalid |
| `isValidSuiAddress` | `(address: string) => boolean` | Non-throwing address format check |

### SEAL Configuration

| Export | Signature | Description |
|--------|-----------|-------------|
| `getSealKeyServers` | `(network: SuiNetwork) => SealKeyServerConfig[]` | Key server configs for a network |
| `getSealThreshold` | `(network: SuiNetwork) => number` | Majority threshold for a network's key server count |

### Message Envelopes

| Export | Description |
|--------|-------------|
| `createMessageEnvelope` | Create a well-formed envelope with `version: 1` and auto-populated `timestamp` |

### Errors

| Export | Description |
|--------|-------------|
| `SweeError` | Base error class; carries `code: SweeErrorCode` and optional `cause` |
| `SweeErrorCode` | Enum of typed error codes across all categories |

**SweeErrorCode values:**

| Code | Category |
|------|----------|
| `NETWORK_ERROR` | Network |
| `RPC_TIMEOUT` | Network |
| `SEAL_ENCRYPT_FAILED` | SEAL |
| `SEAL_DECRYPT_FAILED` | SEAL |
| `SEAL_SESSION_EXPIRED` | SEAL |
| `SEAL_ACCESS_DENIED` | SEAL |
| `WALRUS_UPLOAD_FAILED` | Walrus |
| `WALRUS_DOWNLOAD_FAILED` | Walrus |
| `WALLET_CREATION_FAILED` | Wallet |
| `INSUFFICIENT_BALANCE` | Wallet |
| `SPONSORSHIP_FAILED` | Wallet |
| `BUDGET_EXCEEDED` | Budget |
| `INVALID_ARGUMENT` | Generic |

### Logging

| Export | Description |
|--------|-------------|
| `defaultLogger` | Console-based `SweeLogger` with `[swee:level]` prefixes |

### Feature Flags

| Export | Description |
|--------|-------------|
| `FeatureFlags` | Object of boolean getters; reads environment variables at access time |

## Peer Dependencies

| Package | Version |
|---------|---------|
| `@mysten/sui` | `^1.20.0` |

`@mysten/seal` and `@mysten/walrus` are bundled as direct dependencies.

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
