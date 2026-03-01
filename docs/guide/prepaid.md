# Prepaid (Agent Budgets)

Deposit-based agent budgets for high-frequency API access. One deposit transaction replaces hundreds of per-call payments — ~70x gas savings.

## When to Use

- AI agents making 100+ API calls per session
- High-frequency data feeds
- Any scenario where per-call gas cost exceeds the payment amount

## How It Works

```
Agent                    Provider                 Sui
  |                        |                       |
  |── deposit 1 SUI ──────────────────────────────>|  prepaid::deposit()
  |                        |                       |  → PrepaidBalance (shared)
  |                        |                       |
  |── API call #1 ────────>|                       |
  |<── data ───────────────|                       |
  |── API call #2 ────────>|                       |  No on-chain TX needed!
  |<── data ───────────────|                       |
  |── ... call #500 ──────>|                       |
  |<── data ───────────────|                       |
  |                        |                       |
  |                        |── claim(500) ─────────>|  prepaid::claim()
  |                        |                       |  Provider gets earned funds
```

The agent deposits once. The provider serves API calls off-chain. Periodically, the provider claims earned funds on-chain by reporting the cumulative call count.

## Gas Comparison

| Approach | 1,000 API calls | Cost |
|----------|-----------------|------|
| Per-call exact payments (Base L2) | 1,000 transactions | ~$1.00 gas |
| Prepaid deposit + claim | 2 transactions | ~$0.014 gas |
| **Savings** | | **~70x** |

## Code Example

### Agent: Deposit Budget

```typescript
import { buildPrepaidDepositTx, testnetConfig } from '@sweefi/sui/ptb';

const tx = buildPrepaidDepositTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  provider: '0xPROVIDER_ADDRESS',
  amount: 1_000_000_000n,         // 1 SUI
  ratePerCall: 1_000_000n,        // 0.001 SUI per call
  maxCalls: 1000n,                // max 1,000 calls
  withdrawalDelayMs: 3_600_000n,  // 1 hour withdrawal delay
  feeMicroPercent: 5000,          // 0.5%
  feeRecipient: '0xFEE_ADDR',
});
```

### Provider: Claim Earnings

```typescript
import { buildPrepaidClaimTx, testnetConfig } from '@sweefi/sui/ptb';

const tx = buildPrepaidClaimTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: providerAddress,
  balanceId: '0xBALANCE_ID',
  cumulativeCallCount: 500n,   // total calls served so far
});
```

Claims are **cumulative and idempotent** — submitting `claim(500)` twice is safe. The contract checks `new_count >= balance.claimed_calls`. If `new_count == claimed_calls` (zero delta), the call is a no-op — safe for idempotent retries.

### Agent: Withdraw Remaining Funds

Two-phase withdrawal protects providers from flash-withdraw attacks:

```typescript
import {
  buildRequestWithdrawalTx,
  buildFinalizeWithdrawalTx,
} from '@sweefi/sui/ptb';

// Phase 1: Request withdrawal
const requestTx = buildRequestWithdrawalTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  balanceId: '0xBALANCE_ID',
});

// ... wait for withdrawal delay (e.g., 1 hour) ...

// Phase 2: Finalize withdrawal (get remaining funds back)
const finalizeTx = buildFinalizeWithdrawalTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  balanceId: '0xBALANCE_ID',
});
```

## Trust Model (v0.1 → v0.2 → v0.3)

SweeFi's prepaid system has a progressive trust model:

| Version | Trust Mechanism | Status |
|---------|----------------|--------|
| **v0.1** | Economic bounds only. Provider can over-claim. Withdrawal delay limits damage. | **Deployed** |
| **v0.2** | Signed receipts + fraud proofs. Provider signs each API response. Agent can dispute fraudulent claims. | **Deployed** |
| **v0.3** | TEE attestation. Cryptographic proof of computation. | Planned |

### v0.2 Signed Receipts

Deposit with receipt verification:

```typescript
import { buildDepositWithReceiptsTx } from '@sweefi/sui/ptb';

const tx = buildDepositWithReceiptsTx(testnetConfig, {
  // ... same as deposit, plus:
  providerPubkey: providerEd25519Pubkey,  // 32 bytes
  disputeWindowMs: 3_600_000n,            // 1 hour dispute window
});
```

The provider must sign each API response. If the provider claims more calls than they actually served, the agent can submit a fraud proof:

```typescript
import { buildDisputeClaimTx } from '@sweefi/sui/ptb';

const tx = buildDisputeClaimTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  balanceId: '0xBALANCE_ID',
  receiptBalanceId: receiptBalanceAddr,
  receiptCallNumber: 42n,
  receiptTimestampMs: 1708900000000n,
  receiptResponseHash: responseHash,     // SHA-256 of API response
  signature: providerSignature,          // Ed25519 sig over receipt
});
```

## On-Chain: `prepaid.move`

### Key Functions

| Function | Who | Description |
|----------|-----|-------------|
| `deposit()` | Agent | Create PrepaidBalance (v0.1, unsigned) |
| `deposit_with_receipts()` | Agent | Create with signed receipt verification (v0.2) |
| `claim()` | Provider | Claim earned calls (cumulative count) |
| `finalize_claim()` | Anyone | Finalize pending claim after dispute window (v0.2) |
| `dispute_claim()` | Agent | Submit fraud proof with signed receipt (v0.2) |
| `request_withdrawal()` | Agent | Start 2-phase withdrawal |
| `finalize_withdrawal()` | Agent | Complete withdrawal after delay |
| `cancel_withdrawal()` | Agent | Cancel pending withdrawal |
| `top_up()` | Agent | Add funds to existing balance |
| `agent_close()` | Agent | Close fully-consumed balance |
| `provider_close()` | Provider | Close fully-consumed balance |

### PrepaidBalance (Shared Object)

```
Fields:
  agent: address
  provider: address
  deposited: Balance<T>
  rate_per_call: u64
  claimed_calls: u64        — cumulative (idempotent)
  max_calls: u64
  withdrawal_delay_ms: u64
  fee_micro_pct: u64
  fee_recipient: address
  // v0.2 fields:
  provider_pubkey: vector<u8>
  dispute_window_ms: u64
  pending_claim_count: u64
  disputed: bool
```

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_DEPOSIT` | 1,000,000 MIST | Minimum deposit (~0.001 SUI) |
| `MIN_WITHDRAWAL_DELAY_MS` | 60,000 | 1 minute |
| `MAX_WITHDRAWAL_DELAY_MS` | 604,800,000 | 7 days |
| `MIN_DISPUTE_WINDOW_MS` | 60,000 | 1 minute (v0.2) |
| `MAX_DISPUTE_WINDOW_MS` | 86,400,000 | 24 hours (v0.2) |

## Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 600 | `ENotAgent` | Caller is not the agent |
| 601 | `ENotProvider` | Caller is not the provider |
| 602 | `EZeroDeposit` | Deposit below MIN_DEPOSIT (1,000,000 MIST) |
| 604 | `EWithdrawalLocked` | Withdrawal delay not elapsed |
| 605 | `ECallCountRegression` | New count ≤ current (idempotent safety) |
| 606 | `EMaxCallsExceeded` | Claim exceeds max_calls |
| 617 | `EInvalidFraudProof` | Fraud proof signature invalid (v0.2) |

## Next Steps

- [Exact](/guide/exact) — Simple one-shot payments
- [Streaming](/guide/streaming) — Per-second micropayments
- [Fee & Trust Model](/guide/fee-ownership) — How fees work
- [Move Modules](/guide/contracts) — Full contract reference
