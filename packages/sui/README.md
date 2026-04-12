# @sweefi/sui

Sui-native protocol implementation — PTB builders for payment, stream, escrow, prepaid, and mandate operations.

`@sweefi/sui` is the Sui-specific implementation of the [SweeFi](https://github.com/sweeinc/sweefi) payment protocol. It exposes two surfaces: signer utilities and s402 scheme implementations via the root import, and a complete set of Programmable Transaction Block (PTB) builders for every on-chain contract operation via the `/ptb` subpath.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

## Installation

```bash
npm install @sweefi/sui
```

`@mysten/sui` is a peer dependency and must be installed alongside this package:

```bash
npm install @sweefi/sui @mysten/sui
```

## Subpath Exports

| Import path | Contents |
|-------------|----------|
| `@sweefi/sui` | Signers (`toClientSuiSigner`, `toFacilitatorSuiSigner`), s402 scheme classes, constants, utilities |
| `@sweefi/sui/ptb` | All PTB transaction builders, deployment constants, parameter types |

## Quick Start

Build and sign a payment transaction in two steps:

```typescript
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { toClientSuiSigner, SUI_COIN_TYPE } from "@sweefi/sui";
import { buildPayTx, testnetConfig } from "@sweefi/sui/ptb";

// 1. Set up the signer
const keypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const signer = toClientSuiSigner(keypair, client);

// 2. Build the transaction
const tx = buildPayTx(testnetConfig, {
  coinType: SUI_COIN_TYPE,
  sender: signer.address,
  recipient: "0xb0b...",
  amount: 100_000_000n, // 0.1 SUI in MIST
  feeMicroPercent: 5_000, // 0.5% facilitator fee (micro-percent: 5_000 / 1_000_000)
  feeRecipient: "0xfee...",
  memo: "payment for services",
});

// 3. Sign and execute
const { signature, bytes } = await signer.signTransaction(tx);
// Pass bytes + signature to your facilitator for broadcast,
// or execute directly:
import { toFacilitatorSuiSigner } from "@sweefi/sui";

const facilitator = toFacilitatorSuiSigner();
const digest = await facilitator.executeTransaction(bytes, signature, "sui:testnet");
await facilitator.waitForTransaction(digest, "sui:testnet");
console.log("Confirmed:", digest);
```

## PTB Builder Reference

Import from `@sweefi/sui/ptb`. Every builder takes a `SweefiConfig` as the first argument and a params object as the second, and returns a Sui `Transaction` ready to sign.

```typescript
import { testnetConfig } from "@sweefi/sui/ptb";
// or supply your own config:
const config = { packageId: "0x...", protocolStateId: "0x..." };
```

### Payments

| Builder | Description |
|---------|-------------|
| `buildPayTx` | Direct payment with fee split; receipt auto-transferred to sender |
| `buildPayComposableTx` | Payment that returns the `PaymentReceipt` as a `TransactionResult` for use in the same PTB |
| `buildCreateInvoiceTx` | Create a payment invoice NFT, optionally sending it to a third party |
| `buildPayInvoiceTx` | Pay and consume an existing invoice (replay-protected) |
| `buildPayAndProveTx` | Atomic pay + SEAL proof in a single PTB |

### Streaming

| Builder | Description |
|---------|-------------|
| `buildCreateStreamTx` | Start a rate-limited micropayment stream |
| `buildCreateStreamWithTimeoutTx` | Start a stream with a custom recipient-close timeout (minimum 1 day) |
| `buildClaimTx` | Recipient claims accrued funds from a stream |
| `buildBatchClaimTx` | Claim from multiple streams in one PTB (60–70% gas saving vs individual claims) |
| `buildPauseTx` | Payer pauses an active stream |
| `buildResumeTx` | Payer resumes a paused stream |
| `buildCloseTx` | Payer closes and settles a stream |
| `buildRecipientCloseTx` | Recipient force-closes an abandoned stream after timeout |
| `buildTopUpTx` | Add funds to an existing stream |

### Escrow

| Builder | Description |
|---------|-------------|
| `buildCreateEscrowTx` | Time-locked escrow with arbiter |
| `buildReleaseEscrowTx` | Release funds to seller |
| `buildReleaseEscrowComposableTx` | Release that returns the escrow result for further PTB composition |
| `buildRefundEscrowTx` | Refund buyer (after deadline or by arbiter) |
| `buildDisputeEscrowTx` | Escalate to arbiter |

### Prepaid API Billing

| Builder | Description |
|---------|-------------|
| `buildPrepaidDepositTx` | Agent deposits funds into a `PrepaidBalance` for a provider |
| `buildPrepaidTopUpTx` | Add funds to an existing `PrepaidBalance` |
| `buildPrepaidClaimTx` | Provider claims earned funds (cumulative call count; Move computes delta) |
| `buildRequestWithdrawalTx` | Agent initiates two-phase withdrawal |
| `buildFinalizeWithdrawalTx` | Agent completes withdrawal after the grace period |
| `buildCancelWithdrawalTx` | Agent cancels a pending withdrawal |
| `buildPrepaidAgentCloseTx` | Agent closes a fully-consumed balance |
| `buildPrepaidProviderCloseTx` | Provider closes a balance |

#### v0.2 Signed Receipts (fraud proofs)

| Builder | Description |
|---------|-------------|
| `buildDepositWithReceiptsTx` | Deposit with Ed25519 provider pubkey bound — enables dispute flow |
| `buildPrepaidFinalizeClaimTx` | Finalize a pending claim after the dispute window (permissionless) |
| `buildDisputeClaimTx` | Dispute a pending claim with a signed receipt as fraud proof (agent only) |
| `buildWithdrawDisputedTx` | Withdraw all funds from a disputed balance (agent only, immediate) |

Receipt utilities (also from `@sweefi/sui/ptb`):

| Export | Description |
|--------|-------------|
| `buildReceiptMessage` | Build the BCS-encoded message that gets signed by the provider |
| `signReceipt` | Sign a receipt using a pluggable `Ed25519Signer` |
| `verifyReceipt` | Verify a receipt signature offline (agent-side check before on-chain dispute) |

HTTP-layer receipt helpers (from `@sweefi/sui`):

| Export | Description |
|--------|-------------|
| `signUsageReceipt` | Provider-side: sign a receipt and format as HTTP header value |
| `parseUsageReceipt` | Agent-side: parse header, optionally verify signature |
| `ReceiptAccumulator` | Agent-side: in-memory store keyed by `balanceId`, tracks highest receipt, detects fraud |
| `S402_RECEIPT_HEADER` | Header name constant: `X-S402-Receipt` |
| `PrepaidReceiptConfig` | Server constructor config for v0.2 mode (`providerPubkey` + `disputeWindowMs`) |

Types: `VerifiedReceipt`, `ParsedReceipt`, `Ed25519Signer`, `Ed25519Verifier`

### Mandates

Basic mandates enforce a simple per-transaction spending cap on a delegated agent:

| Builder | Description |
|---------|-------------|
| `buildCreateMandateTx` | Create a basic spending mandate |
| `buildMandatedPayTx` | Pay using a basic mandate |
| `buildCreateRegistryTx` | Create a revocation registry |
| `buildRevokeMandateTx` | Instantly revoke a mandate |

### Agent Mandates

Tiered mandates (L0–L3) add per-transaction, daily, weekly, and lifetime caps enforced by Sui validators:

| Builder | Description |
|---------|-------------|
| `buildCreateAgentMandateTx` | Create a tiered agent mandate with periodic spending caps |
| `buildAgentMandatedPayTx` | Pay using an agent mandate (standard path) |
| `buildAgentMandatedPayCheckedTx` | Pay with on-chain cap enforcement and limit check |
| `buildUpgradeMandateLevelTx` | Upgrade the trust level (L0 through L3) of a mandate |
| `buildUpdateMandateCapsTx` | Update per-tx, daily, weekly, or lifetime caps |

### Admin (Emergency Circuit Breaker)

| Builder | Description |
|---------|-------------|
| `buildAdminPauseTx` | Pause the entire protocol (requires `AdminCap`) |
| `buildAdminUnpauseTx` | Resume protocol operations |
| `buildBurnAdminCapTx` | Permanently burn the `AdminCap` (irreversible) |

## Signer Utilities

### `toClientSuiSigner(keypair, client)`

Wraps any Sui keypair into the `ClientSuiSigner` interface. Works with `Ed25519Keypair`, `Secp256k1Keypair`, and any compatible signer.

```typescript
import { toClientSuiSigner } from "@sweefi/sui";
import type { ClientSuiSigner } from "@sweefi/sui";

const signer: ClientSuiSigner = toClientSuiSigner(keypair, suiClient);
// signer.address          — the sender's Sui address
// signer.signTransaction  — returns { signature, bytes } (both base64-encoded)
```

`signTransaction` builds the transaction against the provided `SuiClient` for gas estimation, then signs the serialized bytes. The returned `bytes` and `signature` can be handed to a facilitator for verification and broadcast, or executed directly.

### `toFacilitatorSuiSigner(config?, keypair?)`

Creates a `FacilitatorSuiSigner` that wraps `SuiClient` operations. Pass an optional keypair only if this facilitator provides gas sponsorship.

```typescript
import { toFacilitatorSuiSigner } from "@sweefi/sui";

// Basic facilitator (no gas sponsorship)
const facilitator = toFacilitatorSuiSigner();

// With a custom RPC URL
const facilitator = toFacilitatorSuiSigner({
  rpcUrl: "https://my-rpc.example.com",
});

// With per-network RPC overrides
const facilitator = toFacilitatorSuiSigner({
  rpcUrls: {
    "sui:mainnet": "https://mainnet-rpc.example.com",
    "sui:testnet": "https://testnet-rpc.example.com",
  },
});
```

`FacilitatorSuiSigner` methods:

| Method | Description |
|--------|-------------|
| `verifySignature(txBytes, sig, network)` | Recover the signer's address from transaction bytes and a signature (Ed25519 and Secp256k1) |
| `simulateTransaction(txBytes, network)` | Dry-run a transaction; returns balance changes, effects, and events |
| `executeTransaction(tx, sig, network)` | Broadcast a signed transaction; returns the digest |
| `waitForTransaction(digest, network)` | Poll until the transaction reaches finality |
| `getTransactionBlock(digest, network)` | Fetch transaction events (optional; used to extract created object IDs from Move events) |

For sponsored transactions, pass `[clientSig, sponsorSig]` as the `signature` argument to `executeTransaction`.

## s402 Scheme Implementations

`@sweefi/sui` ships client, facilitator, and server implementations of the s402 payment protocol for each payment primitive. Import them from `@sweefi/sui`:

| Scheme | Client | Facilitator | Server |
|--------|--------|-------------|--------|
| Exact | `ExactSuiClientScheme` | `ExactSuiFacilitatorScheme` | — |
| Stream | `StreamSuiClientScheme` | `StreamSuiFacilitatorScheme` | `StreamSuiServerScheme` |
| Escrow | `EscrowSuiClientScheme` | `EscrowSuiFacilitatorScheme` | `EscrowSuiServerScheme` |
| Prepaid | `PrepaidSuiClientScheme` | `PrepaidSuiFacilitatorScheme` | `PrepaidSuiServerScheme` |
| Unlock | `UnlockSuiClientScheme` | — | — |
| Direct | `DirectSuiSettlement` | — | — |

**Scheme summary:**

- **Exact** — One-shot payment (`coinWithBalance` to `transferObjects`). Zero setup overhead; suitable for synchronous API responses where a single payment proves access.
- **Prepaid** — Agent deposits a budget upfront; provider submits cumulative call counts to claim. The deposit is the agent's maximum possible loss. Ideal for high-frequency micropayment workloads where per-request on-chain settlement is impractical.
- **Stream** — Two-phase protocol: a 402 handshake opens a `StreamingMeter`, and subsequent requests carry an `X-STREAM-ID` header. Tokens accrue per second against a rate cap. Close the meter to settle final balances.
- **Escrow** — Time-locked escrow with an optional arbiter address. Funds release on seller confirmation or are refunded to the buyer after the deadline. Supports on-chain dispute escalation.
- **Unlock** — Composite escrow + pay-to-decrypt using SEAL. A single atomic transaction pays the seller and unlocks an encryption key, preventing payment without content delivery and vice versa.
- **Direct** — No facilitator. The client signs and broadcasts its own transaction for fully self-sovereign settlement. Useful in trust-minimized or local-only environments.

## Constants

```typescript
import {
  SUI_COIN_TYPE,       // "0x2::sui::SUI"
  USDSUI_MAINNET,      // USDsui — Bridge (Stripe) native stablecoin on Sui mainnet
  USDSUI_DECIMALS,     // 6
  USDC_MAINNET,        // Circle native USDC on Sui mainnet (CCTP, not Wormhole-bridged)
  USDC_TESTNET,        // Circle native USDC on Sui testnet
  USDC_DECIMALS,       // 6
  SUI_DECIMALS,        // 9
  SUI_MAINNET_CAIP2,   // "sui:mainnet"
  SUI_TESTNET_CAIP2,   // "sui:testnet"
  SUI_DEVNET_CAIP2,    // "sui:devnet"
  MAINNET_RPC_URL,
  TESTNET_RPC_URL,
  DEVNET_RPC_URL,
} from "@sweefi/sui";
```

PTB deployment constants (from `@sweefi/sui/ptb`):

```typescript
import {
  testnetConfig,          // { packageId: TESTNET_PACKAGE_ID, protocolStateId: TESTNET_PROTOCOL_STATE }
  TESTNET_PACKAGE_ID,     // Latest deployed package (full suite including mandate + prepaid)
  TESTNET_PROTOCOL_STATE, // Shared ProtocolState object ID (required for stream/escrow create ops)
  TESTNET_ADMIN_CAP,      // AdminCap object ID (deployer-owned)
  TESTNET_UPGRADE_CAP,    // UpgradeCap object ID (deployer-owned)
  SUI_CLOCK,              // "0x6" — Sui's well-known Clock shared object
} from "@sweefi/sui/ptb";
```

## Utilities

```typescript
import {
  createSuiClient,      // Create a SuiClient from a CAIP-2 network identifier
  getUsdcCoinType,      // Get the canonical USDC coin type for a given network
  validateSuiAddress,   // Check that an address is 0x + 64 hex chars (fully zero-padded)
  convertToTokenAmount, // Convert a decimal string + decimals to base units (no float intermediates)
  coinTypesEqual,       // Compare two coin types for equality after normalization
} from "@sweefi/sui";
```

`convertToTokenAmount` uses pure string arithmetic to avoid floating-point precision loss — safe for financial calculations:

```typescript
import { convertToTokenAmount, USDC_DECIMALS } from "@sweefi/sui";

convertToTokenAmount("0.10", USDC_DECIMALS); // "100000" (0.10 USDC in base units)
convertToTokenAmount("1.5", 9);              // "1500000000" (1.5 SUI in MIST)
```

## Peer Dependencies

| Package | Version | Notes |
|---------|---------|-------|
| `@mysten/sui` | `^2.0.0` | Sui TypeScript SDK |
| `@sweefi/hono` | `>=0.1.0` | s402 fetch wrapper (used by `createS402Client`) |

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
