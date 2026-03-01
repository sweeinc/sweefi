# Escrow (Trustless Trade)

Time-locked escrow with three-party dispute resolution. Lock funds, release on delivery, refund on deadline.

## When to Use

- Digital goods purchases (buyer doesn't trust seller)
- Freelance work (milestone-based payments)
- Any transaction where both parties need protection
- Combined with [SEAL](/guide/seal) for pay-to-decrypt

## How It Works

```
Buyer                Seller               Arbiter              Sui
  |                    |                    |                    |
  |── create escrow ──────────────────────────────────────────>|
  |   (1 SUI, seller,  |                    |                    |
  |    arbiter, 7d)     |                    |                    |
  |                    |                    |                    |
  |   [seller delivers goods]               |                    |
  |                    |                    |                    |
  |── release ────────────────────────────────────────────────>|
  |   → funds to seller + EscrowReceipt     |                    |
  |                    |                    |                    |
  | ─── OR ───         |                    |                    |
  |                    |                    |                    |
  |── dispute ────────────────────────────────────────────────>|
  |                    |── dispute ─────────────────────────-->|
  |                    |                    |                    |
  |                    |                    |── release/refund ─>|
  |                    |                    |   (arbiter decides)|
  |                    |                    |                    |
  | ─── OR (deadline passed) ───            |                    |
  |                    |                    |                    |
  |  [anyone] ── refund ──────────────────────────────────────>|
  |   → funds returned to buyer             |                    |
```

## Code Example

### Create Escrow (Buyer)

```typescript
import { buildCreateEscrowTx, testnetConfig } from '@sweefi/sui/ptb';

const tx = buildCreateEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: buyerAddress,
  seller: '0xSELLER',
  arbiter: '0xARBITER',      // trusted dispute resolver
  depositAmount: 1_000_000_000n, // 1 SUI
  deadlineMs: BigInt(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  feeMicroPercent: 5000,       // 0.5%
  feeRecipient: '0xFEE_ADDR',
  memo: 'Website redesign - milestone 1',
});
```

### Release Funds (Buyer or Arbiter)

```typescript
import { buildReleaseEscrowTx } from '@sweefi/sui/ptb';

const tx = buildReleaseEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: buyerAddress,
  escrowId: '0xESCROW_ID',
});
// Funds go to seller. EscrowReceipt created (usable for SEAL).
```

### Refund (Anyone, After Deadline)

```typescript
import { buildRefundEscrowTx } from '@sweefi/sui/ptb';

const tx = buildRefundEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: anyoneAddress,       // permissionless after deadline
  escrowId: '0xESCROW_ID',
});
// Funds returned to buyer.
```

### Dispute (Buyer or Seller)

```typescript
import { buildDisputeEscrowTx } from '@sweefi/sui/ptb';

const tx = buildDisputeEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: buyerAddress,        // or seller
  escrowId: '0xESCROW_ID',
});
// Now only the arbiter can release or refund.
```

## State Machine

```
ACTIVE (0)
  │
  ├── release() → RELEASED (2)   [buyer only]
  ├── dispute() → DISPUTED (1)   [buyer or seller]
  │       │
  │       ├── release() → RELEASED (2)  [arbiter only]
  │       └── refund()  → REFUNDED (3)  [arbiter only]
  │
  └── (deadline passes)
        └── refund() → REFUNDED (3)  [anyone — permissionless]
```

Every escrow eventually resolves. No funds can be locked forever.

## Grace Period

When a dispute is raised, the deadline is extended by a grace period to give the arbiter time to resolve. This prevents deadline-racing:

```
Grace period = clamp(50% of duration, 7 days, 30 days)
             = min(max(50% of duration, 7 days), 30 days)
```

For a 7-day escrow: grace period = 7 days (floor).
For a 90-day escrow: grace period = 30 days (cap).

## On-Chain: `escrow.move`

### Escrow (Shared Object)

```
Fields:
  buyer: address
  seller: address
  arbiter: address
  balance: Balance<T>
  amount: u64              — original deposit
  deadline_ms: u64
  state: u8                — ACTIVE(0), DISPUTED(1), RELEASED(2), REFUNDED(3)
  fee_micro_pct: u64
  fee_recipient: address
  created_at_ms: u64       — used for grace period calculation
  description: vector<u8>  — max 1024 bytes
```

### EscrowReceipt

Created on `release()`. Owned object with `key + store` — serves as a SEAL decryption credential.

```
Fields:
  escrow_id: ID          — links back to the original escrow
  buyer: address
  seller: address
  amount: u64
  fee_amount: u64
  token_type: String
  released_at_ms: u64
  released_by: address
```

### Safety Rules

- The arbiter cannot be the buyer or the seller
- The buyer cannot be the seller
- Description max length: 1024 bytes
- Minimum deposit: 1,000,000 MIST

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 200 | `ENotBuyer` | Caller is not the buyer |
| 201 | `ENotSeller` | Caller is not the seller |
| 202 | `ENotArbiter` | Caller is not the arbiter |
| 205 | `EDeadlineNotReached` | Too early for permissionless refund |
| 208 | `EAlreadyDisputed` | Escrow already in disputed state |
| 212 | `EArbiterIsSeller` | Arbiter and seller are the same address |

## Next Steps

- [SEAL](/guide/seal) — Use EscrowReceipt for pay-to-decrypt
- [Exact](/guide/exact) — Simple one-shot payments
- [Streaming](/guide/streaming) — Per-second micropayments
- [Move Modules](/guide/contracts) — Full contract reference
