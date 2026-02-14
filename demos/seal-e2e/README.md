# SweePay SEAL E2E Demo — Atomic Pay-to-Decrypt

> Live on Sui testnet. Real transactions. Verifiable on-chain.

## What This Demonstrates

The full pay-to-decrypt flow using SweePay escrow + SEAL encryption + Walrus storage:

```
Seller                                    Buyer
  │                                         │
  │    1. Buyer creates escrow ────────────►│ (deposit locked)
  │◄── 2. Seller encrypts with escrow_id    │
  │    3. Upload to Walrus ─────────────────│ (ciphertext stored)
  │                                         │
  │    4. Buyer releases escrow ───────────►│ (gets EscrowReceipt)
  │                                         │
  │         SEAL key servers validate       │
  │         receipt via dry-run of          │
  │         seal_policy::seal_approve       │
  │                                         │
  │    5. Buyer decrypts from Walrus ──────►│ (content revealed)
```

**Neither party can cheat:**
- Buyer can't decrypt without paying (SEAL policy checks receipt)
- Seller can't take money without delivering (escrow holds funds)
- After deadline, buyer gets automatic refund (permissionless timeout)

## Run It

```bash
# From sweepay-project root
cd demos/seal-e2e
pnpm install

# Set your testnet private key (base64 Ed25519)
export SUI_PRIVATE_KEY="<your key>"

# Run the demo
pnpm demo
```

Need testnet SUI? Visit https://faucet.sui.io

## What Happens

1. **Create Escrow** — Buyer deposits 10,000 MIST. Escrow becomes a shared object.
2. **SEAL Encrypt** — Secret content encrypted with key ID = `[escrow_id][nonce]`.
3. **Walrus Upload** — Encrypted blob stored on Walrus testnet (1 epoch).
4. **Release Escrow** — Buyer releases funds to seller, receives `EscrowReceipt`.
5. **Session Key** — Buyer creates ephemeral session key (10 min TTL).
6. **Download + Decrypt** — SEAL key servers dry-run `seal_approve(id, receipt)`. If the receipt's escrow_id matches the key ID prefix, decryption keys are released.
7. **Verify** — Decrypted content matches original.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Buyer Wallet │────►│ SweePay Escrow   │────►│ EscrowReceipt│
│ (Ed25519)    │     │ (shared object)  │     │ (owned obj)  │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                      │
      ┌───────────────────────────────────────────────┘
      │ receipt satisfies SEAL policy
      ▼
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ SEAL Servers │────►│ seal_approve()   │────►│ Decrypt Key  │
│ (2 testnet)  │     │ (dry-run only)   │     │ (threshold)  │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                      │
      ┌───────────────────────────────────────────────┘
      │ key decrypts Walrus blob
      ▼
┌──────────────┐     ┌──────────────────┐
│ Walrus       │────►│ Plaintext        │
│ (encrypted)  │     │ (revealed)       │
└──────────────┘     └──────────────────┘
```

## Key Code: seal_policy.move (70 lines)

```move
entry fun seal_approve(
    id: vector<u8>,              // SEAL key ID: [escrow_id][nonce]
    receipt: &escrow::EscrowReceipt,  // proof of payment
    ctx: &TxContext,
) {
    // 1. Only the buyer can decrypt
    assert!(ctx.sender() == escrow::receipt_buyer(receipt));
    // 2. Key ID must start with escrow_id bytes
    let prefix = escrow::receipt_escrow_id(receipt).to_bytes();
    // ... prefix match check
}
```

This function is called by SEAL key servers in dry-run. If it doesn't abort, decryption keys are released. 70 lines that replace an entire centralized access control server.

## Dependencies

- `@sweepay/sui` — PTB builders for escrow create/release
- `@mysten/seal` — SEAL encryption/decryption client
- `@mysten/sui` — Sui client, keypairs, transactions
- Walrus testnet — Blob storage (publisher + aggregator)
- SEAL testnet — 2 key servers (threshold 2/2)
