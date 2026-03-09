# Move Modules Overview

SweeFi's smart contracts are 10 Move modules deployed on Sui testnet. 264 test functions. Core payment functions are `public` (composable in PTBs), with `entry` convenience wrappers for common flows.

## Package Info

**Testnet**: `0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef`

## Module Map

| Module | Purpose | Object Model |
|--------|---------|--------------|
| [`payment`](/guide/exact) | Direct payments, invoices, receipts | PaymentReceipt: **owned** |
| [`stream`](/guide/streaming) | Per-second micropayments with budget caps | StreamingMeter: **shared** |
| [`escrow`](/guide/escrow) | Time-locked escrow with arbiter disputes | Escrow: **shared**, EscrowReceipt: **owned** |
| [`prepaid`](/guide/prepaid) | Deposit-based agent budgets, batch-claim | PrepaidBalance: **shared** |
| [`seal_policy`](/guide/seal) | SEAL pay-to-decrypt integration | — (read-only) |
| [`mandate`](/guide/mandates) | Basic AP2 spending delegation | Mandate: **owned** |
| [`agent_mandate`](/guide/mandates) | L0–L3 progressive autonomy, lazy reset | AgentMandate: **owned** |
| `identity` | Agent identity profiles (`did:sui`) | AgentIdentity: **owned** |
| `math` | Shared arithmetic (safe division, micro-percent) | — (library) |
| `admin` | Emergency pause, AdminCap | ProtocolState: **shared** |

## Object Ownership Model

```
Owned (fast path, ~200ms, no consensus):
  PaymentReceipt, EscrowReceipt, Invoice
  Mandate, AgentMandate, AgentIdentity, AdminCap

Shared (consensus path, ~2-3s):
  StreamingMeter, Escrow, PrepaidBalance, ProtocolState
  IdentityRegistry, RevocationRegistry
```

**Rule**: An object is shared only when multiple distinct addresses mutate it. Read-only multi-party access does NOT require sharing.

## Key Design Patterns

### 1. Composable PTBs (ADR-001)

Core payment, stream, escrow, and prepaid functions are `public` (composable in PTBs), with `entry` convenience wrappers:

```move
// public — returns receipt, composable
public fun pay<T>(...) → PaymentReceipt

// entry — transfers receipt, convenience wrapper
entry fun pay_and_keep<T>(...)
```

This means you can chain operations: `pay() → transfer receipt → call SEAL` in a single atomic transaction.

**Exception**: Mandate operations (`create_registry`, `revoke`, `upgrade_level`, `update_caps`) are `entry`-only with no `public` counterparts — they are standalone admin actions, not composable building blocks.

### 2. u128 Intermediate Math (ADR-003)

All fee calculations use `u128` intermediate to prevent overflow. The Cetus protocol lost $223M to a `u64` overflow — SweeFi avoids this:

```move
// In math.move — used by ALL modules:
const FEE_DENOMINATOR: u128 = 1_000_000; // micro-percent

public fun calculate_fee(amount: u64, fee_micro_pct: u64): u64 {
    let result = ((amount as u128) * (fee_micro_pct as u128)) / FEE_DENOMINATOR;
    assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
    (result as u64)
}
```

### 3. Two-Tier Pause (ADR-004)

The `ProtocolState` pause flag blocks new operations but **exits are always open**:

| Guarded (blocked when paused) | Unguarded (always allowed) |
|-------------------------------|---------------------------|
| `stream.create`, `stream.top_up` | `stream.claim`, `stream.close`, `stream.recipient_close` |
| `escrow.create` | `escrow.release`, `escrow.refund`, `escrow.dispute` |
| `prepaid.deposit`, `prepaid.top_up` | `prepaid.claim`, `prepaid.request_withdrawal` |
| `identity.create` | Everything in `payment` |

AdminCap has no fund extraction rights. It can only pause/unpause or burn itself.

### 4. Permissionless Exits

Both `stream.recipient_close()` and escrow deadline refunds are permissionless — anyone can call them after the timeout/deadline. This ensures funds cannot be locked forever by payer inaction.

### 5. Bearer Receipts (ADR-005)

Receipts (`PaymentReceipt`, `EscrowReceipt`) are bearer credentials. Ownership = access. No `ctx.sender()` checks on SEAL decryption. If you can pass the receipt as a transaction argument, you own it — Sui's VM enforces this.

## Error Code Series

| Module | Series | Range |
|--------|--------|-------|
| `payment` | 0s | 0–2 |
| `stream` | 100s | 100–111 |
| `escrow` | 200s | 200–215 |
| `seal_policy` | 300 | 300 |
| `mandate` | 400s | 400–405 |
| `admin` | 500s | 500–501 |
| `agent_mandate` | 500s | 500–510 |
| `prepaid` | 600s | 600–622 |
| `identity` | 700s | 700–705 |
| `math` | 900 | 900 |

## Move Test Summary

264 test functions (core 10 modules):
- ~160 positive (happy path)
- ~104 expected-failure (error condition coverage)

Token-gated SEAL (separate package): 5 additional tests.

All deposits in tests use ≥ `MIN_DEPOSIT` (1,000,000 MIST).

```bash
# Run all Move tests
cd contracts && sui move test
```

## Next Steps

- [Mandates](/guide/mandates) — AP2 mandate system (L0–L3)
- [Fee & Trust Model](/guide/fee-ownership) — Micro-percent fee system
- [Exact Payments](/guide/exact) — payment.move details
- [Streaming](/guide/streaming) — stream.move details
