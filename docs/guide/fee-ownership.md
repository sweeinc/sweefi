# Fee & Trust Model

How SweeFi handles fees across all payment schemes.

## Micro-Percent Fee System

SweeFi uses **micro-percent** as the fee unit across all contracts and the TypeScript SDK. This provides sub-basis-point precision at AI agent micropayment scale.

```
Denominator: 1,000,000 (FEE_DENOMINATOR)
1,000,000 = 100%
  10,000  = 1%
   5,000  = 0.5%
   1,000  = 0.1%
     100  = 0.01%
       1  = 0.0001%
```

### Common Values

| Micro-Percent | Percentage | Use Case |
|---------------|-----------|----------|
| 0 | 0% | No fee (P2P) |
| 1,000 | 0.1% | Low-fee API |
| 5,000 | 0.5% | Standard facilitator fee |
| 10,000 | 1% | Premium service |
| 50,000 | 5% | Marketplace fee |
| 1,000,000 | 100% | Maximum (invalid in practice) |

### In Move Contracts

```move
// math.move — shared by all modules
const FEE_DENOMINATOR: u128 = 1_000_000;

public fun calculate_fee(amount: u64, fee_micro_pct: u64): u64 {
    let result = ((amount as u128) * (fee_micro_pct as u128)) / FEE_DENOMINATOR;
    assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
    (result as u64)
}
```

All modules call `math::calculate_fee()`. The u128 intermediate prevents overflow — Cetus lost $223M to a u64 overflow; SweeFi avoids this by design.

### In TypeScript SDK

```typescript
// PTB builders accept feeMicroPercent directly
buildPayTx(config, {
  amount: 1_000_000n,
  feeMicroPercent: 5000,      // 0.5%
  feeRecipient: '0xFEE_ADDR',
  // ...
});

// Convert basis points to micro-percent: multiply by 100
const microPct = 50 * 100; // 50 bps → 5000 micro-percent
```

Basis points → micro-percent is a simple `× 100` conversion. The SDK and contracts use micro-percent natively.

## Fee Ownership

**Fees belong to the facilitator, not the server.** This is a load-bearing design decision.

```
Agent ──> Server ──> Facilitator ──> Sui
                         │
                         ├── Sends payment to recipient
                         └── Sends fee to feeRecipient
```

The `feeRecipient` address is set per-route by the server in its `s402Gate` config. It's encoded in the s402 payment header and forwarded to the facilitator, which includes the fee transfer in the settlement PTB.

### Why Facilitator-Owned

- **Server operators** set the fee rate and recipient — they control the economics
- **Facilitators** execute the settlement — they earn fees for the service
- **Agents** see the fee before signing — full transparency
- **No hidden fees** — the fee amount is computed on-chain and visible in the receipt

### Fee Flow

```
Amount: 1,000,000 MIST (0.001 SUI)
Fee: 5,000 micro-percent (0.5%)

calculate_fee(1_000_000, 5_000) = 5,000 MIST

Recipient gets: 1,000,000 - 5,000 = 995,000 MIST
Fee recipient gets: 5,000 MIST
```

Fees are always **truncated** (floor), never rounded up. This prevents dust accumulation edge cases.

## Fee Rounding: Always Truncate

SweeFi truncates fee calculations to prevent rounding-up exploits:

```move
// Integer division truncates naturally in Move
let result = ((amount as u128) * (fee_micro_pct as u128)) / FEE_DENOMINATOR;

// Example: 999 * 5000 / 1_000_000 = 4.995 → truncated to 4
// Agent pays 4 MIST in fees, not 5
```

This is documented in ADR-003 (Fee Rounding & Financial Precision).

## Zero-Fee Payments

Setting `feeMicroPercent: 0` and `feeRecipient` to any address (including your own) results in zero fees. No fee transfer occurs — the entire amount goes to the recipient.

## Per-Scheme Fee Behavior

| Scheme | When Fee Is Charged |
|--------|-------------------|
| **Exact** | At payment time (in `pay()`) |
| **Streaming** | At each `claim()` (on accrued amount) |
| **Escrow** | At `release()` (on escrowed amount) |
| **Prepaid** | At each `claim()` (on claimed amount) |

Fees are never charged on refunds, withdrawals, or dispute resolutions.

## Trust Model Summary

| Component | Trust Level | What It Can Do |
|-----------|-------------|---------------|
| **Agent** | Untrusted | Can only spend within mandate limits |
| **Server** | Semi-trusted | Sets pricing and fee rates |
| **Facilitator** | Semi-trusted | Verifies + broadcasts. Cannot extract funds. |
| **AdminCap** | Limited | Pause new deposits. Cannot extract funds. Cannot block exits. |
| **Move contracts** | Trustless | Enforce all invariants at consensus level |

The facilitator is a relay — it cannot forge receipts, redirect payments, or access locked funds. Self-hosting is always an option.

## Next Steps

- [Move Modules](/guide/contracts) — Full contract reference
- [Mandates](/guide/mandates) — Spending authorization model
- [Exact Payments](/guide/exact) — See fees in the payment flow
- [Self-Hosting Facilitator](/guide/facilitator) — Run your own settlement service
