# @sweefi/solana

Solana-native s402 payment adapter — exact SPL token and native SOL transfers with browser-safe signing.

`@sweefi/solana` is the Solana-specific implementation of the [SweeFi](https://github.com/sweeinc/sweefi) payment protocol. It implements the `PaymentAdapter` interface from `@sweefi/ui-core`, exposes two-sided signer abstractions (`ClientSolanaSigner` for payers, `FacilitatorSolanaSigner` for verifiers), and provides the full s402 scheme trio (client, server, facilitator) for exact payments.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

## Installation

```bash
npm install @sweefi/solana
```

`@solana/web3.js` and `@solana/spl-token` are peer dependencies and must be installed alongside this package:

```bash
npm install @sweefi/solana @solana/web3.js @solana/spl-token
```

## Peer Dependencies

| Package | Version |
|---------|---------|
| `@solana/web3.js` | `^1.95.0` |
| `@solana/spl-token` | `^0.4.0` |

## Quick Start

### Node.js agent (keypair)

```typescript
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import {
  SolanaPaymentAdapter,
  SolanaKeypairSigner,
  SOLANA_DEVNET_CAIP2,
  USDC_DEVNET_MINT,
} from '@sweefi/solana';

// 1. Set up the connection and signer
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const keypair = Keypair.fromSecretKey(secretKeyBytes);
const wallet = new SolanaKeypairSigner(keypair);

// 2. Create the adapter
const adapter = new SolanaPaymentAdapter({
  wallet,
  connection,
  network: SOLANA_DEVNET_CAIP2,
});

// 3. Simulate before committing
const sim = await adapter.simulate({
  s402Version: '1',
  accepts: ['exact'],
  network: SOLANA_DEVNET_CAIP2,
  asset: USDC_DEVNET_MINT,
  amount: '1000000',          // 1 USDC (6 decimals)
  payTo: '0xRecipient...',
});

if (sim.success) {
  console.log('Estimated fee:', sim.estimatedFee); // { amount: 5000n, currency: 'SOL' }
}

// 4. Sign and broadcast
const { txId } = await adapter.signAndBroadcast({
  s402Version: '1',
  accepts: ['exact'],
  network: SOLANA_DEVNET_CAIP2,
  asset: USDC_DEVNET_MINT,
  amount: '1000000',
  payTo: '0xRecipient...',
});

console.log('Confirmed:', txId); // base58 transaction signature
```

### Browser wallet (Phantom, Backpack, etc.)

```typescript
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SolanaPaymentAdapter, SolanaWalletSigner } from '@sweefi/solana';

function usePaymentAdapter() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // SolanaWalletSigner wraps any @solana/wallet-adapter-base compatible wallet
  const signer = new SolanaWalletSigner(wallet);

  return new SolanaPaymentAdapter({
    wallet: signer,
    connection,
    network: 'solana:mainnet-beta',
  });
}
```

### Native SOL transfer

Pass `NATIVE_SOL_MINT` (or the string `'native'`) as the `asset` field:

```typescript
import { NATIVE_SOL_MINT, SOLANA_DEVNET_CAIP2 } from '@sweefi/solana';

const { txId } = await adapter.signAndBroadcast({
  s402Version: '1',
  accepts: ['exact'],
  network: SOLANA_DEVNET_CAIP2,
  asset: NATIVE_SOL_MINT,
  amount: '1000000000', // 1 SOL in lamports
  payTo: 'Recipient...',
});
```

## PaymentAdapter Interface

`SolanaPaymentAdapter` implements the `PaymentAdapter` interface from `@sweefi/ui-core`:

| Method | Description |
|--------|-------------|
| `network` | CAIP-2 identifier (`'solana:mainnet-beta'`, `'solana:devnet'`, or `'solana:testnet'`) |
| `getAddress()` | Returns the payer's base58 public key, or `null` if the wallet is disconnected |
| `simulate(reqs)` | Dry-run the transaction. Returns `{ success, estimatedFee? }` or `{ success: false, error }` |
| `signAndBroadcast(reqs)` | Sign, broadcast, and confirm the transaction. Returns `{ txId }` |

`simulate()` builds the exact same instruction set as `signAndBroadcast()` — including protocol fee splits — using a legacy `Transaction` so simulation results match on-chain behavior.

## Signer Utilities

### `SolanaKeypairSigner` — Node.js agents and CLI tools

```typescript
import { Keypair } from '@solana/web3.js';
import { SolanaKeypairSigner } from '@sweefi/solana';

const keypair = Keypair.fromSecretKey(secretKeyBytes);
const signer = new SolanaKeypairSigner(keypair);

// signer.address — base58 public key
// signer.signTransaction(tx, connection) — signs, returns { serialized, signature, blockhash, lastValidBlockHeight }
```

**Use this when:** running an autonomous agent, a CLI tool, or any server-side process with direct access to a keypair.

### `SolanaWalletSigner` — Browser wallets

```typescript
import { SolanaWalletSigner } from '@sweefi/solana';
import type { SolanaWalletAdapter } from '@sweefi/solana';

// Any wallet implementing { publicKey, signTransaction } works — no hard dep on wallet-adapter-base
const signer = new SolanaWalletSigner(wallet);
```

**Use this when:** building a frontend where the private key lives in a browser extension (Phantom, Backpack, Solflare, etc.). `SolanaWalletSigner` delegates signing to the wallet's `signTransaction` method and never touches the private key.

### Blockhash threading — why `signTransaction` returns `blockhash`

Every Solana transaction embeds a recent blockhash at sign time. That same blockhash's `lastValidBlockHeight` is the deadline for confirmation.

A naive implementation fetches a fresh blockhash twice: once when building the transaction and again when calling `confirmTransaction`. If the second fetch returns a different `lastValidBlockHeight` (which happens whenever a new blockhash is produced between the two calls), `confirmTransaction` may report expiry even though the transaction succeeds on-chain.

`@sweefi/solana` avoids this by threading the blockhash through the signing stack:

```typescript
// ClientSolanaSigner.signTransaction returns all four values:
const { serialized, signature, blockhash, lastValidBlockHeight } =
  await signer.signTransaction(tx, connection);

// ExactSolanaClientScheme.createPaymentWithMeta surfaces them:
const { s402Payload, blockhash, lastValidBlockHeight } =
  await scheme.createPaymentWithMeta(requirements);

// SolanaPaymentAdapter.signAndBroadcast uses the sign-time blockhash — no second fetch:
await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
```

This guarantees that the confirmation window matches the transaction exactly.

### `toFacilitatorSolanaSigner(config?)` — server-side verification

```typescript
import { toFacilitatorSolanaSigner } from '@sweefi/solana';

// Uses public cluster endpoints by default
const facilitator = toFacilitatorSolanaSigner();

// With a custom RPC URL
const facilitator = toFacilitatorSolanaSigner({
  rpcUrl: 'https://my-rpc.example.com',
});

// With per-network overrides
const facilitator = toFacilitatorSolanaSigner({
  rpcUrls: {
    'solana:mainnet-beta': 'https://mainnet-rpc.example.com',
    'solana:devnet': 'https://devnet-rpc.example.com',
  },
});
```

`FacilitatorSolanaSigner` methods:

| Method | Description |
|--------|-------------|
| `verifyAndGetPayer(serializedTx, network)` | Ed25519-verify the payer's signature via Web Crypto API. Returns the payer's base58 address or throws |
| `simulateTransaction(serializedTx, network)` | Dry-run; returns pre/post SOL and SPL token balances keyed by account index |
| `executeTransaction(serializedTx, network)` | Broadcast raw signed bytes; returns the transaction signature (txid) |
| `confirmTransaction(signature, network)` | Wait for `'confirmed'` finality; throws on failure |

`verifyAndGetPayer` uses `crypto.subtle.verify('Ed25519', ...)` — zero extra dependencies, works in Node.js 18+ and all modern browsers.

## s402 Scheme Implementations

| Scheme | Client | Facilitator | Server |
|--------|--------|-------------|--------|
| Exact | `ExactSolanaClientScheme` | `ExactSolanaFacilitatorScheme` | `ExactSolanaServerScheme` |
| Prepaid | — | — | — |
| Stream | — | — | — |
| Escrow | — | — | — |

**Only the Exact scheme is implemented.** Prepaid, Stream, and Escrow require Anchor programs that have not yet been deployed on Solana. Those will be added once the on-chain programs are ready.

- **Exact** — One-shot transfer. For SPL tokens, the client signs a `createTransferInstruction` from their ATA to the recipient's ATA. For native SOL, it uses `SystemProgram.transfer`. Protocol fee splits are handled atomically by adding a second instruction to the same transaction.

### Server scheme — building payment requirements

```typescript
import { ExactSolanaServerScheme, SOLANA_DEVNET_CAIP2, USDC_DEVNET_MINT } from '@sweefi/solana';

const server = new ExactSolanaServerScheme();

const requirements = server.buildRequirements({
  network: SOLANA_DEVNET_CAIP2,
  payTo: 'YourWallet...',
  amount: '1000000', // 1 USDC
  asset: USDC_DEVNET_MINT, // optional — defaults to USDC for the network
  protocolFeeBps: 50,      // optional — 0.5%
  protocolFeeAddress: 'FeeWallet...',
});
// Returns a fully-formed s402PaymentRequirements object
```

### Client scheme — building a payment payload

```typescript
import { ExactSolanaClientScheme, SolanaKeypairSigner } from '@sweefi/solana';
import { Connection } from '@solana/web3.js';

const scheme = new ExactSolanaClientScheme(
  new SolanaKeypairSigner(keypair),
  new Connection(clusterApiUrl('devnet'), 'confirmed'),
);

// Standard interface method (returns payload only)
const payload = await scheme.createPayment(requirements);

// Extended method (also returns blockhash metadata for confirmTransaction)
const { s402Payload, blockhash, lastValidBlockHeight } =
  await scheme.createPaymentWithMeta(requirements);
```

### Facilitator scheme — verifying and settling

```typescript
import { ExactSolanaFacilitatorScheme, toFacilitatorSolanaSigner } from '@sweefi/solana';

const scheme = new ExactSolanaFacilitatorScheme(toFacilitatorSolanaSigner());

// Cryptographically verify + simulate (does not submit on-chain)
const verification = await scheme.verify(payload, requirements);
// { valid: true, payerAddress: '...' } or { valid: false, invalidReason: '...' }

// Verify + submit on-chain
const settlement = await scheme.settle(payload, requirements);
// { success: true, txDigest: '...', finalityMs: 450 }
```

`verify()` runs a 4-step check:
1. Scheme validation (is the payload type `'exact'`?)
2. Network validation (is this actually a Solana network?)
3. Signature recovery — cryptographic proof the payer signed the transaction (Web Crypto Ed25519)
4. Simulation — would this transaction succeed if submitted?
5. Balance verification — did the recipient's account increase by the required amount?

`settle()` re-runs verification before submitting, mirroring the defense-in-depth pattern from `@sweefi/sui`.

## Constants

```typescript
import {
  SOLANA_MAINNET_CAIP2,  // 'solana:mainnet-beta'
  SOLANA_DEVNET_CAIP2,   // 'solana:devnet'
  SOLANA_TESTNET_CAIP2,  // 'solana:testnet'
  NATIVE_SOL_MINT,       // 'So11111111111111111111111111111111111111112'
  USDC_MAINNET_MINT,     // 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  USDC_DEVNET_MINT,      // '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  USDC_DECIMALS,         // 6
  SOL_DECIMALS,          // 9
  LAMPORTS_PER_SOL,      // 1_000_000_000
  BASE_FEE_LAMPORTS,     // 5_000n
} from '@sweefi/solana';
```

## Utilities

```typescript
import {
  createSolanaConnection,   // Create a Connection from a CAIP-2 network identifier
  networkToCluster,         // 'solana:devnet' → 'devnet'
  getDefaultUsdcMint,       // Returns the correct USDC mint for mainnet-beta or devnet
  uint8ArrayToBase64,       // Browser-safe Uint8Array → base64 (btoa, not Buffer)
  base64ToUint8Array,       // Browser-safe base64 → Uint8Array (atob, not Buffer)
} from '@sweefi/solana';

// createSolanaConnection accepts an optional RPC URL override
const connection = createSolanaConnection('solana:devnet');
const connection = createSolanaConnection('solana:mainnet-beta', 'https://my-rpc.example.com');
```

**Browser note:** All binary/base64 conversions in `@sweefi/solana` use `btoa`/`atob` (Web Platform globals). `Buffer.from()` is intentionally avoided — it is a Node.js global absent in browsers without a polyfill (e.g., Vite does not include one by default).

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
