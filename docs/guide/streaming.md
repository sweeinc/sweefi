# Streaming (Micropayments)

Per-second micropayments for continuous access. Create a stream, claim accrued funds, pause, resume, close.

## When to Use

- AI inference billing (pay per second of compute)
- Live data feeds (market data, sensor streams)
- Video/audio streaming
- Any time-based access

## How It Works

```
Payer                    Recipient                Sui
  |                        |                       |
  |── create stream ──────────────────────────────>|  stream::create()
  |   (deposit 1 SUI,      |                       |  → StreamingMeter (shared)
  |    0.001 SUI/sec)       |                       |
  |                        |                       |
  |   [time passes — 100 seconds]                  |
  |                        |                       |
  |                        |── claim ──────────────>|  stream::claim()
  |                        |   claimable = 0.1 SUI  |  → funds to recipient
  |                        |                       |
  |── pause ──────────────────────────────────────>|  stream::pause()
  |   [accrual stops]      |                       |
  |── resume ─────────────────────────────────────>|  stream::resume()
  |   [accrual resumes]    |                       |
  |                        |                       |
  |── close ──────────────────────────────────────>|  stream::close()
  |   [remaining funds returned to payer]          |
```

Accrual is computed at claim time: `elapsed_seconds × rate_per_second`. The stream is a shared object — both payer and recipient interact with it.

## Code Example

### Create a Stream

```typescript
import { buildCreateStreamTx, testnetConfig } from '@sweefi/sui/ptb';

const tx = buildCreateStreamTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: payerAddress,
  recipient: providerAddress,
  depositAmount: 1_000_000_000n,   // 1 SUI
  ratePerSecond: 1_000_000n,       // 0.001 SUI/sec
  budgetCap: 5_000_000_000n,       // Max 5 SUI total
  feeMicroPercent: 5000,           // 0.5%
  feeRecipient: '0xFEE_ADDR',
});
```

### Create with Custom Timeout

By default, recipients can force-close abandoned streams after 7 days. Customize this:

```typescript
import { buildCreateStreamWithTimeoutTx } from '@sweefi/sui/ptb';

const tx = buildCreateStreamWithTimeoutTx(testnetConfig, {
  // ... same params, plus:
  recipientCloseTimeoutMs: 86_400_000n, // 1 day (min: 1 day, max: 30 days)
});
```

### Claim Accrued Funds (Recipient)

```typescript
import { buildClaimTx } from '@sweefi/sui/ptb';

const tx = buildClaimTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: recipientAddress,
  meterId: '0xMETER_ID',
});
```

### Pause / Resume (Payer)

```typescript
import { buildPauseTx, buildResumeTx } from '@sweefi/sui/ptb';

// Pause accrual
const pauseTx = buildPauseTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: payerAddress,
  meterId: '0xMETER_ID',
});

// Resume accrual
const resumeTx = buildResumeTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: payerAddress,
  meterId: '0xMETER_ID',
});
```

### Close Stream (Payer)

```typescript
import { buildCloseTx } from '@sweefi/sui/ptb';

const tx = buildCloseTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: payerAddress,
  meterId: '0xMETER_ID',
});
// Accrued funds go to recipient, remaining balance returns to payer
```

### Recipient Force-Close (Abandoned Stream)

If the payer abandons a stream, the recipient can force-close after the timeout:

```typescript
import { buildRecipientCloseTx } from '@sweefi/sui/ptb';

const tx = buildRecipientCloseTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: recipientAddress,
  meterId: '0xMETER_ID',
});
// Works after the recipient-close timeout has elapsed
```

### Top Up (Payer)

```typescript
import { buildTopUpTx } from '@sweefi/sui/ptb';

const tx = buildTopUpTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: payerAddress,
  meterId: '0xMETER_ID',
  depositAmount: 500_000_000n,  // Add 0.5 SUI
});
```

## Budget Cap Safety

The `budgetCap` is a hard limit — the stream can never pay out more than this amount regardless of how long it runs. This is enforced at the contract level, protecting payers from unbounded spending.

```
budget_cap = 5 SUI
rate = 0.001 SUI/sec
Maximum stream duration = 5,000 seconds (~83 minutes)
```

After the cap is reached, `claim()` will abort with `ENothingToClaim` (error 106). Close the stream to return any remaining balance to the payer.

## On-Chain: `stream.move`

### StreamingMeter (Shared Object)

```
Fields:
  payer: address
  recipient: address
  balance: Balance<T>
  rate_per_second: u64
  budget_cap: u64
  total_claimed: u64
  last_claim_ms: u64
  created_at_ms: u64
  active: bool
  paused_at_ms: u64
  fee_micro_pct: u64
  fee_recipient: address
```

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_DEPOSIT` | 1,000,000 | Minimum deposit (~0.001 SUI) |
| `RECIPIENT_CLOSE_TIMEOUT_MS` | 604,800,000 | Default 7 days |
| `MIN_RECIPIENT_CLOSE_TIMEOUT_MS` | 86,400,000 | 1 day minimum |
| `MAX_RECIPIENT_CLOSE_TIMEOUT_MS` | 2,592,000,000 | 30 days maximum |

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 100 | `ENotPayer` | Caller is not the payer |
| 101 | `ENotRecipient` | Caller is not the recipient |
| 102 | `EStreamInactive` | Stream is paused or closed |
| 105 | `EZeroDeposit` | Deposit below MIN_DEPOSIT (1,000,000) |
| 108 | `EBudgetCapExceeded` | Top-up would exceed budget cap |
| 109 | `ETimeoutNotReached` | Too early for recipient close |
| 110 | `ETimeoutTooShort` | Custom timeout below minimum |
| 111 | `ETimeoutTooLong` | Custom timeout above maximum |

## Next Steps

- [Exact](/guide/exact) — Simple one-shot payments
- [Prepaid](/guide/prepaid) — Deposit-based agent budgets
- [Escrow](/guide/escrow) — Time-locked trustless trade
- [Move Modules](/guide/contracts) — Full contract reference
