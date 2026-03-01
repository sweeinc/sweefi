# @sweefi/sui

The core package. 40+ PTB builders, s402 client/facilitator scheme classes, and the `SuiPaymentAdapter` for UI integration.

## Install

```bash
pnpm add @sweefi/sui @mysten/sui
```

`@mysten/sui` is a peer dependency — you bring your own version (`^2.0.0`).

## Quick Example

```typescript
import { createS402Client } from '@sweefi/sui';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const wallet = Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!);
const client = createS402Client({ wallet, network: 'sui:testnet' });

// Auto-pays any 402 response
const res = await client.fetch('https://api.example.com/data');
```

## Subpath Exports

The package has two entry points:

| Import | What It Provides |
|--------|-----------------|
| `@sweefi/sui` | High-level client, signers, adapter, s402 schemes, constants |
| `@sweefi/sui/ptb` | All PTB builders, config types, deployment addresses |

```typescript
// High-level — for apps and agents
import { createS402Client, SuiPaymentAdapter } from '@sweefi/sui';

// Low-level — for custom PTB construction
import { buildPayTx, buildCreateStreamTx, testnetConfig } from '@sweefi/sui/ptb';
```

## PTB Builders

Every builder returns a Sui `Transaction` ready to sign. Pass a `SweefiConfig` (package ID + protocol state) as the first argument.

```typescript
import { testnetConfig } from '@sweefi/sui/ptb';

const config = testnetConfig; // { packageId, protocolStateId }
```

### Payment Builders

```typescript
import {
  buildPayTx,
  buildPayComposableTx,
  buildPayAndProveTx,
  buildCreateInvoiceTx,
  buildPayInvoiceTx,
} from '@sweefi/sui/ptb';
```

| Builder | Description |
|---------|-------------|
| `buildPayTx` | Direct payment → `PaymentReceipt` transferred to sender |
| `buildPayComposableTx` | Returns receipt as a PTB result (for chaining) |
| `buildPayAndProveTx` | Pay + transfer receipt in one atomic PTB |
| `buildCreateInvoiceTx` | Create an `Invoice` NFT |
| `buildPayInvoiceTx` | Consume invoice with payment |

### Streaming Builders

```typescript
import {
  buildCreateStreamTx,
  buildCreateStreamWithTimeoutTx,
  buildClaimTx,
  buildBatchClaimTx,
  buildPauseTx,
  buildResumeTx,
  buildCloseTx,
  buildRecipientCloseTx,
  buildTopUpTx,
} from '@sweefi/sui/ptb';
```

| Builder | Who Calls | Description |
|---------|-----------|-------------|
| `buildCreateStreamTx` | Payer | Create a streaming meter |
| `buildCreateStreamWithTimeoutTx` | Payer | Create with custom recipient-close timeout |
| `buildClaimTx` | Recipient | Claim accrued funds |
| `buildBatchClaimTx` | Recipient | Claim from multiple streams |
| `buildPauseTx` | Payer | Pause accrual |
| `buildResumeTx` | Payer | Resume accrual |
| `buildCloseTx` | Payer | Close stream, return remaining funds |
| `buildRecipientCloseTx` | Recipient | Force-close abandoned stream |
| `buildTopUpTx` | Payer | Add more funds to stream |

### Escrow Builders

```typescript
import {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildReleaseEscrowComposableTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
} from '@sweefi/sui/ptb';
```

| Builder | Who Calls | Description |
|---------|-----------|-------------|
| `buildCreateEscrowTx` | Buyer | Create time-locked escrow |
| `buildReleaseEscrowTx` | Buyer/Arbiter | Release funds to seller |
| `buildReleaseEscrowComposableTx` | Buyer/Arbiter | Release (composable in PTB chain) |
| `buildRefundEscrowTx` | Anyone (after deadline) | Refund to buyer |
| `buildDisputeEscrowTx` | Buyer/Seller | Escalate to arbiter |

### Prepaid Builders

```typescript
import {
  buildPrepaidDepositTx,
  buildPrepaidTopUpTx,
  buildPrepaidClaimTx,
  buildRequestWithdrawalTx,
  buildFinalizeWithdrawalTx,
  buildCancelWithdrawalTx,
  buildPrepaidAgentCloseTx,
  buildPrepaidProviderCloseTx,
  // v0.2 Signed Receipts:
  buildDepositWithReceiptsTx,
  buildPrepaidFinalizeClaimTx,
  buildDisputeClaimTx,
  buildWithdrawDisputedTx,
} from '@sweefi/sui/ptb';
```

| Builder | Who Calls | Description |
|---------|-----------|-------------|
| `buildPrepaidDepositTx` | Agent | Deposit budget (v0.1, unsigned) |
| `buildDepositWithReceiptsTx` | Agent | Deposit with signed receipt verification (v0.2) |
| `buildPrepaidTopUpTx` | Agent | Add funds to existing balance |
| `buildPrepaidClaimTx` | Provider | Claim earned calls |
| `buildPrepaidFinalizeClaimTx` | Anyone | Finalize pending claim (v0.2) |
| `buildDisputeClaimTx` | Agent | Submit fraud proof (v0.2) |
| `buildRequestWithdrawalTx` | Agent | Start 2-phase withdrawal |
| `buildFinalizeWithdrawalTx` | Agent | Complete withdrawal after delay |
| `buildCancelWithdrawalTx` | Agent | Cancel pending withdrawal |
| `buildPrepaidAgentCloseTx` | Agent | Close fully-consumed balance |
| `buildPrepaidProviderCloseTx` | Provider | Close fully-consumed balance |
| `buildWithdrawDisputedTx` | Agent | Withdraw after successful dispute (v0.2) |

### Mandate Builders

```typescript
import {
  buildCreateMandateTx,
  buildMandatedPayTx,
  buildCreateRegistryTx,
  buildRevokeMandateTx,
  buildCreateAgentMandateTx,
  buildAgentMandatedPayTx,
  buildAgentMandatedPayCheckedTx,
  buildUpgradeMandateLevelTx,
  buildUpdateMandateCapsTx,
} from '@sweefi/sui/ptb';
```

| Builder | Who Calls | Description |
|---------|-----------|-------------|
| `buildCreateMandateTx` | Delegator | Create basic spending mandate |
| `buildMandatedPayTx` | Delegate | Pay using a mandate |
| `buildCreateRegistryTx` | Delegator | Create revocation registry |
| `buildRevokeMandateTx` | Delegator | Instantly revoke a mandate |
| `buildCreateAgentMandateTx` | Delegator | Create L0–L3 tiered mandate |
| `buildAgentMandatedPayTx` | Delegate | Pay with agent mandate |
| `buildAgentMandatedPayCheckedTx` | Delegate | Pay with revocation check |
| `buildUpgradeMandateLevelTx` | Delegator | Upgrade mandate tier |
| `buildUpdateMandateCapsTx` | Delegator | Update spending caps |

### Admin Builders

```typescript
import {
  buildAdminPauseTx,
  buildAdminUnpauseTx,
  buildBurnAdminCapTx,
} from '@sweefi/sui/ptb';
```

## Signers

```typescript
import { toClientSuiSigner, toFacilitatorSuiSigner } from '@sweefi/sui';
```

| Signer | Use Case |
|--------|----------|
| `toClientSuiSigner(keypair, client)` | Client-side signing (agents, CLI) |
| `toFacilitatorSuiSigner(config?)` | Server-side verification + broadcast |

## SuiPaymentAdapter

Implements the `PaymentAdapter` interface from `@sweefi/ui-core` for Sui:

```typescript
import { SuiPaymentAdapter } from '@sweefi/sui';
import { SuiClient } from '@mysten/sui/client';

const adapter = new SuiPaymentAdapter({
  signer: toClientSuiSigner(keypair, suiClient),
  network: 'sui:testnet',
});

// Used by PaymentController in @sweefi/ui-core
adapter.getAddress();       // → '0x...'
adapter.simulate(reqs);     // → { success: true, estimatedFee: ... }
adapter.signAndBroadcast(reqs); // → { txId: '...' }
```

## s402 Scheme Classes

Protocol-level scheme implementations used by the facilitator and client:

| Class | Side | Scheme |
|-------|------|--------|
| `ExactSuiClientScheme` | Client | Exact |
| `ExactSuiFacilitatorScheme` | Facilitator | Exact |
| `StreamSuiClientScheme` | Client | Stream |
| `StreamSuiFacilitatorScheme` | Facilitator | Stream |
| `EscrowSuiClientScheme` | Client | Escrow |
| `EscrowSuiFacilitatorScheme` | Facilitator | Escrow |
| `PrepaidSuiClientScheme` | Client | Prepaid |
| `PrepaidSuiFacilitatorScheme` | Facilitator | Prepaid |
| `UnlockSuiClientScheme` | Client | SEAL Unlock |
| `DirectSuiSettlement` | — | Direct (no facilitator) |

## Constants

```typescript
import {
  SUI_COIN_TYPE,       // '0x2::sui::SUI'
  USDC_MAINNET,        // mainnet USDC type
  USDC_TESTNET,        // testnet USDC type
  SUI_MAINNET_CAIP2,   // 'sui:35834a8a'
  SUI_TESTNET_CAIP2,   // 'sui:4c78adac'
  MAINNET_RPC_URL,
  TESTNET_RPC_URL,
} from '@sweefi/sui';
```

## Utilities

| Function | Description |
|----------|-------------|
| `createSuiClient(network)` | Create `SuiClient` from CAIP-2 network string |
| `getUsdcCoinType(network)` | Get canonical USDC coin type for a network |
| `validateSuiAddress(addr)` | Validate `0x` + 64 hex format |
| `convertToTokenAmount(decimal, decimals)` | String arithmetic (no floats in money paths) |
| `coinTypesEqual(a, b)` | Normalized coin type comparison |

## Next Steps

- [Exact Payments](/guide/exact) — How one-shot payments work
- [Streaming](/guide/streaming) — Per-second micropayments
- [Prepaid](/guide/prepaid) — Agent budget deposits
- [@sweefi/server](/guide/server) — HTTP middleware that uses these builders
