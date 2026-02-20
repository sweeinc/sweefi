# ADR-001: Composable PTB Pattern (entry vs public)

**Status:** Accepted
**Date:** 2026-02-13
**Authors:** Strategy AI (Session 109), Builder AI (Session 108)

## Context

SweeFi's Move contracts need to support two usage modes:

1. **Simple** -- caller wants a one-shot action (pay, release escrow, close stream). The receipt or effect is automatically transferred to the caller. Done.
2. **Composable** -- caller wants to chain multiple on-chain actions in a single atomic transaction. Example: pay a seller AND receive a PaymentReceipt AND use that receipt as a SEAL decryption condition -- all in one PTB.

Sui Move distinguishes `entry` functions (can only be the terminal call, handle their own transfers) from `public` functions (return values that the PTB can pass to subsequent calls). This distinction is the foundation of SweeFi's composability model.

## Decision

Every SweeFi module that produces a receipt or transferable object exposes **two variants**:

| Pattern | Move function | TS builder | Returns |
|---------|--------------|------------|---------|
| Simple (entry) | `pay_and_keep` | `buildPayTx()` | `Transaction` |
| Composable (public) | `pay` | `buildPayComposableTx()` | `{ tx, receipt }` |

The composable variant returns `{ tx, receipt }` where `receipt` is a `TransactionResult` -- a reference to an on-chain object that hasn't been created yet but will be when the PTB executes. The caller can pass this to subsequent `moveCall` or `transferObjects` within the same PTB.

### The Hero Example: `buildPayAndProveTx`

Combines both steps into a single builder for the most common composable flow:

```typescript
import { buildPayAndProveTx, testnetConfig } from "@sweefi/sui/ptb";

const tx = buildPayAndProveTx(testnetConfig, {
  coinType: "0x2::sui::SUI",
  sender: buyerAddress,
  recipient: sellerAddress,
  amount: 1_000_000n,       // 0.001 SUI
  feeBps: 50,               // 0.5% facilitator fee
  feeRecipient: facilitatorAddress,
  receiptDestination: buyerAddress,  // buyer keeps receipt for SEAL
  memo: "seal:content-id:abc123",
});

// Sign and execute -- one transaction, atomic
const result = await client.signAndExecuteTransaction({ transaction: tx, signer });
```

What happens on-chain (one transaction):
1. `payment::pay<SUI>` executes -- coins move to seller, fee to facilitator
2. `PaymentReceipt` object is created with payer, amount, timestamp, memo
3. Receipt is transferred to `receiptDestination` (buyer or their agent)

If any step fails, everything reverts. No "paid but no receipt" state.

### Delegated Access

The `receiptDestination` parameter enables a powerful pattern: the human pays, but their AI agent receives the receipt. The agent can then prove receipt ownership to SEAL key servers for decryption -- without needing the human's wallet keys.

```
Human wallet  --pays-->  Seller
     |
     +--receipt-->  AI Agent address  --proves ownership-->  SEAL decrypt
```

## Consequences

### Positive

- **Atomic pay-to-access**: Eliminates the reconciliation gap between payment and access. No "payment succeeded but access grant failed" states.
- **SEAL-native**: Receipt IDs are first-class SEAL access conditions. Encrypt content against a receipt ID, buyer decrypts by proving ownership.
- **Agent-friendly**: Delegated `receiptDestination` means agents can hold proofs without holding funds.
- **Zero shared state**: PaymentReceipt has `key + store` (owned object). No consensus bottleneck. Receipt creation scales linearly.

### Negative

- **Two functions per operation**: Maintenance burden of keeping `entry` and `public` variants in sync. Mitigated by sharing internal logic in Move.
- **Developer choice**: Caller must know which variant to use. Mitigated by documentation and the convenience `buildPayAndProveTx` wrapper.

### Modules Using This Pattern

| Module | Entry (simple) | Public (composable) |
|--------|---------------|-------------------|
| payment | `pay_and_keep` | `pay` |
| escrow | `release_and_keep` | `release` |

Stream module uses `entry` only (stream operations don't produce transferable receipts).

### The Encryption Primitive: `seal_policy`

The fourth module (`seal_policy`, added in v4) completes the pay-to-decrypt loop. It exposes a single function:

```move
sweefi::seal_policy::seal_approve(id: vector<u8>, receipt: &EscrowReceipt, ctx: &TxContext)
```

This is **not a user-facing PTB**. It's called by SEAL key servers during dry-run evaluation. The flow:

1. Seller encrypts content using SEAL, with the policy set to `sweefi::seal_policy::seal_approve`
2. Buyer pays via `buildPayAndProveTx` -- gets `PaymentReceipt` (or `EscrowReceipt` from escrow release)
3. Buyer requests decryption from SEAL key servers
4. SEAL key servers dry-run `seal_approve` with the buyer's receipt -- if the receipt is valid and owned by the requester, the key server releases the decryption key
5. Buyer decrypts content locally

The Move contract is the **access policy**. No centralized access control server. No API keys. No "revoke access" admin panel. The receipt IS the key.

```
Seller encrypts ──> Walrus (storage)
                         |
Buyer pays ──> gets Receipt ──> SEAL key server dry-runs seal_approve
                                        |
                                  key released ──> Buyer decrypts
```

### The Full Atomic Flow (All 4 Modules)

```
One PTB:
  payment::pay()           → PaymentReceipt (proof of payment)
  transferObjects(receipt)  → buyer owns the proof

SEAL infrastructure (separate, async):
  seal_policy::seal_approve(receipt) → key server validates → decryption key released

Result:
  Buyer has content. Seller has money. Facilitator has fee. All verifiable on-chain.
  No reconciliation. No admin. No support tickets.
```

## ADR-002: Batch Claims & Economic Analysis

### Context

Deep economic analysis of Sui gas costs revealed that per-claim gas (~$0.005) makes sub-minute streaming claims unprofitable at low accrual rates ($0.0003/sec). The break-even claim interval is ~17 seconds; the efficient operating point is 5+ minute claims (5.6% gas overhead).

### Decision

1. **`buildBatchClaimTx`** — Claims from N streams in a single PTB. Reduces per-stream gas by 60-70% by amortizing the base transaction cost across multiple moveCall operations.

2. **SDK-level claim guidance** — The SDK should recommend minimum claim thresholds. Don't claim unless accrued value exceeds a configurable minimum (default: 20x gas cost).

3. **Gas sponsorship path** — Facilitators can sponsor recipient claim gas via Sui's `GasData` mechanism, making gas an operational cost rather than a recipient burden.

### Economic Context

| Claim Interval | Accrued at $0.0003/sec | Gas % |
|---|---|---|
| 1 second | $0.0003 | 1,667% (loss) |
| 5 minutes | $0.09 | 5.6% (competitive) |
| 30 minutes | $0.54 | 0.9% (excellent) |

At $0.001/sec (GPT-4 class inference), even 2-minute claims keep gas under 5%.

### Key Insight

The streaming meter accrues per-millisecond on-chain (the math is precise), but settlement is a periodic batch operation. This is the correct architecture — like a water meter that ticks every drop but is read monthly.

## References

- `packages/sui/src/ptb/composable.ts` -- `buildPayAndProveTx` implementation
- `packages/sui/src/ptb/payment.ts` -- `buildPayComposableTx` (lower-level)
- `packages/sui/src/ptb/escrow.ts` -- `buildReleaseEscrowComposableTx`
- `contracts/sources/payment.move` -- `pay` (public) vs `pay_and_keep` (entry)
- `contracts/sources/escrow.move` -- `release` (public) vs `release_and_keep` (entry)
- `contracts/sources/seal_policy.move` -- `seal_approve` (SEAL key server dry-run policy)
- Sui docs: [Programmable Transaction Blocks](https://docs.sui.io/concepts/transactions/prog-txn-blocks)
- Mysten SEAL: [Decentralized Secrets Management](https://docs.sui.io/guides/developer/cryptography/seal)
