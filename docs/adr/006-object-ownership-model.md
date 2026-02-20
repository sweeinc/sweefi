# ADR-006: Object Ownership Model

**Status:** Accepted
**Date:** 2026-02-13
**Authors:** Strategy AI (Session 108), Builder AI (Session 109)

## Context

Sui has two fundamental object categories that affect performance, scalability, and correctness:

1. **Owned objects**: Belong to a single address. Transactions using only owned objects skip consensus — they execute on a single validator via fast-path (sub-second finality, ~200ms). No contention possible.
2. **Shared objects**: Accessible by multiple addresses. Transactions touching shared objects go through Sui's consensus (Narwhal/Bullshark) — higher latency (~2-3 seconds), potential contention under high throughput on the same object.

SweeFi must choose the correct ownership model for each on-chain object. The wrong choice either:
- Makes objects inaccessible to necessary parties (owned when it should be shared), or
- Adds unnecessary consensus overhead to hot paths (shared when it could be owned)

## Decision

### Ownership Assignment by Object Type

| Object | Abilities | Ownership | Rationale |
|--------|-----------|-----------|-----------|
| `PaymentReceipt` | `key, store` | **Owned** | Single-party (buyer). Created and immediately transferred to buyer. Never needs multi-party access. Hot path — payments should be fast. |
| `Invoice` | `key` | **Owned** | Single-party (creator → payer). Transferred from creator to payer. Only the holder interacts with it. |
| `StreamingMeter<T>` | `key` | **Shared** | Two-party (payer + recipient). Payer pauses/resumes/closes/tops-up. Recipient claims. Both need mutable access to the same object. |
| `Escrow<T>` | `key` | **Shared** | Three-party (buyer + seller + arbiter). Any of the three may need to mutate state (release, refund, dispute). Plus permissionless deadline refund. |
| `EscrowReceipt` | `key, store` | **Owned** | Single-party (buyer). Created on escrow release, transferred to buyer. Same rationale as PaymentReceipt. |

### Design Principle: Minimize Shared Objects

**Rule**: An object is shared only when multiple distinct addresses must mutate it. Read-only multi-party access does not require sharing — Sui allows anyone to read any object.

```
                    Mutated by 1 party?  → Owned (fast path)
Object decision:
                    Mutated by 2+ parties? → Shared (consensus path)
```

### Payment Hot Path: Pure Owned Objects

The most common SweeFi operation — single payment — touches only owned objects:

```
pay<T>():
  Input:  Coin<T>       (owned by payer)
  Output: PaymentReceipt (owned, transferred to payer)
          Coin<T>        (owned, transferred to recipient)
          Coin<T>        (owned, transferred to fee_recipient)
```

No shared objects. No consensus. Fast-path execution. This means SweeFi payments scale linearly with validator throughput — there's no shared-object contention bottleneck.

This is a critical advantage over designs that use a shared "payment ledger" or "protocol registry" — those create a consensus bottleneck on every payment.

### Stream Operations: Shared by Necessity

The `StreamingMeter<T>` must be shared because:
- **Payer** calls: `pause()`, `resume()`, `close()`, `top_up()`
- **Recipient** calls: `claim()`, `recipient_close()`

Both addresses mutate the same object. There's no way to split this into two owned objects without breaking atomicity (e.g., if payer closes while recipient claims).

The `StreamingMeter` uses `key` only (no `store`). This means it **cannot be transferred** — the payer/recipient relationship is fixed at creation. This is intentional: changing a stream's payer or recipient mid-stream would break the security model.

### Escrow: Shared by Trilateral Design

The `Escrow<T>` is the most interaction-heavy shared object:
- **Buyer**: can release (if ACTIVE) or dispute
- **Seller**: can dispute
- **Arbiter**: can release or refund (if DISPUTED)
- **Anyone**: can refund after deadline (permissionless)

Four distinct callers may mutate the same object. Sharing is non-negotiable.

Like `StreamingMeter`, `Escrow` uses `key` only — non-transferable. The buyer/seller/arbiter addresses are fixed at creation.

### Receipt Objects: Owned + Transferable

Both `PaymentReceipt` and `EscrowReceipt` use `key + store`:
- `key`: Can be owned, addressed, and referenced on-chain
- `store`: Can be transferred, wrapped, and composed

This is the correct combination for bearer credentials (see ADR-005). The receipt starts owned by the buyer but can be transferred to agents, contracts, or other users.

## Consequences

### Positive

- **Payment throughput**: No shared-object bottleneck on the most common operation. SweeFi payments can saturate Sui's owned-object throughput (~100k+ TPS theoretical).
- **Predictable latency**: Payments = fast path (~200ms). Streams/escrows = consensus path (~2-3s). Users and integrators can set expectations accordingly.
- **Correct access control**: Owned objects are inherently access-controlled — only the owner can use them in transactions. No additional `assert!(sender == owner)` checks needed for receipts and invoices.
- **No global contention**: Unlike designs with a shared protocol registry, SweeFi has no single shared object that all transactions must touch. Each stream and escrow is independent.

### Negative

- **Stream/escrow contention**: Under very high throughput to the *same* stream or escrow (e.g., thousands of claims per second to one meter), Sui's consensus will serialize operations. This is unlikely in practice — streams have one payer and one recipient, not thousands of concurrent callers.
- **AdminCap impact (if ADR-004 accepted)**: Adding a shared `ProtocolState` for emergency pause would add a shared-object read to the payment path, losing the pure owned-object fast-path advantage. This is the main architectural trade-off of ADR-004 and should be carefully benchmarked.

### Object Ability Reference

| Ability | Meaning | SweeFi Usage |
|---------|---------|---------------|
| `key` | Can be an on-chain object with unique ID | All objects |
| `store` | Can be transferred, wrapped, stored in other objects | Receipts only (bearer credentials) |
| `key` only | Non-transferable — fixed to creation-time relationships | StreamingMeter, Escrow |
| `key + store` | Transferable — bearer-style ownership | PaymentReceipt, EscrowReceipt |

## References

- Sui documentation: [Object Ownership](https://docs.sui.io/concepts/object-ownership)
- Sui documentation: [Shared vs Owned Objects](https://docs.sui.io/concepts/object-ownership/shared)
- `contracts/sources/payment.move` — `PaymentReceipt` (key, store), `Invoice` (key)
- `contracts/sources/stream.move` — `StreamingMeter<T>` (key), `share_object()` at creation
- `contracts/sources/escrow.move` — `Escrow<T>` (key), `EscrowReceipt` (key, store), `share_object()` at creation
- ADR-001: Composable PTB Pattern (depends on `store` ability for cross-PTB composition)
- ADR-005: Permissive Access & Receipt Transferability (depends on `key + store` for bearer model)
