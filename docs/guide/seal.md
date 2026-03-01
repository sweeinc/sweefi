# SEAL (Pay-to-Decrypt)

Trustless content gating using Sui's [SEAL](https://docs.sui.io/concepts/cryptography/seal) (Sui Encryption Abstraction Layer). Pay for content and decrypt it — no server trust required.

## When to Use

- Paywalled articles, videos, or datasets
- Encrypted file sales
- Any scenario where "pay → receive decryption key" should be trustless

## What Is SEAL?

SEAL is Sui's threshold encryption system. Content is encrypted with a key held by a distributed network of key servers. The key servers release the decryption key only when the caller can prove they satisfy an on-chain access condition — in SweeFi's case, owning a `PaymentReceipt` or `EscrowReceipt`.

This means:
- **The server never holds the decryption key** — it's split across key servers
- **Access is enforced on-chain** — the Move contract checks receipt ownership
- **Receipts are bearer credentials** — ownership = access, no sender checks

## How It Works

```
Buyer                  Server                SEAL Key Servers       Sui
  |                      |                        |                  |
  |── buy content ──────>|                        |                  |
  |<── 402 + price ──────|                        |                  |
  |                      |                        |                  |
  |── pay (exact/escrow) ──────────────────────────────────────────>|
  |   → PaymentReceipt or EscrowReceipt           |                  |
  |                      |                        |                  |
  |── request decrypt key ───────────────────────>|                  |
  |   [dry-run seal_approve()]                    |── check receipt ─>|
  |                      |                        |<── receipt valid ─|
  |<── decryption key ───────────────────────────|                  |
  |                      |                        |                  |
  |── decrypt content locally                     |                  |
```

Key insight: the SEAL key servers call `seal_approve()` in a **dry-run** — they don't execute a transaction. They just verify that the caller owns a valid receipt.

## On-Chain: `seal_policy.move`

### `seal_approve()`

The entry point for SEAL key servers:

```move
public entry fun seal_approve(
    id: vector<u8>,
    receipt: &escrow::EscrowReceipt,
    ctx: &TxContext
)
```

This function is called by SEAL key servers in dry-run mode. It verifies that the `receipt`'s `escrow_id` matches the content `id`. If the check passes, the key servers release the decryption key.

### No Sender Checks

`seal_approve` does **not** check `ctx.sender()`. Sui's object ownership model enforces holder-only access at the VM level — if you can pass the receipt as a transaction argument, you own it.

This was a deliberate security decision (ADR-005, H-1 fix). A sender check would lock decryption rights to the original buyer forever, breaking receipt transfers and agent delegation.

### Access Condition

The check is simple: does the receipt's `escrow_id` match the content identifier?

```move
fun check_policy(
    id: vector<u8>,
    receipt: &escrow::EscrowReceipt,
    _ctx: &TxContext
): bool {
    let receipt_id = escrow::receipt_escrow_id(receipt);
    object::id_to_bytes(&receipt_id) == id
}
```

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 300 | `ENoAccess` | Receipt doesn't match content ID |

## Usage with Escrow

The most natural SEAL flow uses escrow — the buyer creates an escrow, the seller releases it, and the `EscrowReceipt` becomes the decryption credential:

```typescript
import {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
} from '@sweefi/sui/ptb';

// 1. Buyer creates escrow for encrypted content
const escrowTx = buildCreateEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: buyerAddress,
  seller: contentProviderAddress,
  arbiter: arbiterAddress,
  amount: 5_000_000_000n,  // 5 SUI for premium dataset
  deadlineMs: BigInt(Date.now() + 7 * 24 * 60 * 60 * 1000),
  feeMicroPercent: 0,
  feeRecipient: buyerAddress,
  description: new TextEncoder().encode('encrypted-dataset-v2'),
});

// 2. Seller releases escrow → EscrowReceipt created
const releaseTx = buildReleaseEscrowTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: contentProviderAddress,  // or buyer
  escrowId: escrowObjectId,
});

// 3. Buyer now owns EscrowReceipt → can decrypt via SEAL
```

## Usage with Exact Payments

`PaymentReceipt` from `payment.move` can also serve as SEAL credentials, though this requires a separate SEAL policy module that checks `PaymentReceipt` instead of `EscrowReceipt`.

## Receipt Transferability

Since receipts are bearer credentials (`key + store`), they can be:
- **Transferred** to another address (e.g., gift access)
- **Used by agents** (delegated access via mandate)
- **Held indefinitely** (permanent access to purchased content)

## Next Steps

- [Escrow](/guide/escrow) — Time-locked escrow lifecycle
- [Exact](/guide/exact) — One-shot payments with receipts
- [Move Modules](/guide/contracts) — Full contract reference
- [Fee & Trust Model](/guide/fee-ownership) — How fees work
