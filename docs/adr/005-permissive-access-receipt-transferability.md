# ADR-005: Permissive Access & Receipt Transferability

**Status:** Accepted
**Date:** 2026-02-13
**Authors:** Builder AI (Session 109), Strategy AI (Session 108)

## Context

During security review, several "permissive" patterns were identified in SweeFi's contracts:

1. **Payer == recipient is allowed**: A user can pay themselves, stream to themselves, or create an escrow where buyer == seller.
2. **Receipts are transferable**: `PaymentReceipt` and `EscrowReceipt` have `key + store` abilities, meaning they can be transferred to any address after creation.
3. **Delegated receipt destination**: The composable PTB pattern allows sending a receipt to an address different from the payer.

The question: are these bugs or features?

## Decision

### All three are intentional features.

### 1. Payer == Recipient: Valid Self-Pay

**No restriction is enforced.** A user can call `pay<T>()` with their own address as `recipient`.

**Why this is correct:**

- **Receipt generation**: The primary reason to self-pay is to generate a `PaymentReceipt` for SEAL decryption. "Pay yourself $0.01 to get a receipt that unlocks content" is a valid use case — the receipt is the product, not the payment.
- **Fee is caller-controlled**: `fee_micro_pct` is set by the caller. Self-pay with `fee_micro_pct=0` is a net-zero operation (you send coins to yourself). Adding a restriction would add gas cost to every transaction for a "protection" that protects no one.
- **Testing and development**: Self-pay simplifies integration testing — developers can test the full pay→receipt→SEAL flow with a single wallet.
- **No economic harm**: The only cost is gas. No third party is affected. The fee recipient (if any) is chosen by the caller.

**Rejected alternative**: `assert!(sender != recipient, ESelfPayNotAllowed)`. This adds ~200 gas to every payment, prevents legitimate receipt-generation use cases, and protects against nothing — the "attacker" is only attacking themselves.

### 2. Receipt Transferability: key + store

Both receipt types are defined with `key + store`:

```move
public struct PaymentReceipt has key, store { ... }
public struct EscrowReceipt has key, store { ... }
```

This means receipts can be:
- Transferred to another address via `transfer::public_transfer`
- Wrapped inside other objects
- Listed on marketplaces (NFT-like behavior)
- Passed to smart contracts as arguments

**Why this is correct:**

- **SEAL access is ownership-gated**: SEAL key servers check `seal_approve()` which verifies the receipt exists and the requester owns it. If you transfer your receipt, you transfer your decryption rights. This is the correct behavior — receipts are bearer credentials.
- **Composability requires `store`**: Without `store`, receipts couldn't be passed between PTB steps or wrapped in other protocol objects. The composable pattern (ADR-001) depends on this.
- **Secondary markets**: Receipt transferability enables legitimate secondary markets. "I bought access to this content but don't need it anymore" → transfer the receipt → new owner can decrypt. This is a feature for content creators (broader distribution) and buyers (liquidity).

**SEAL access follows ownership, not address history:**

```
Alice pays → gets PaymentReceipt
Alice transfers receipt → Bob
Bob calls SEAL decrypt → SEAL checks Bob owns receipt → Bob gets key
Alice calls SEAL decrypt → SEAL checks Alice owns... nothing → denied
```

The receipt IS the credential. Whoever holds it has access. This is the digital equivalent of a concert ticket — transferable, bearer-authenticated.

### 3. Delegated receiptDestination

The `buildPayAndProveTx` composable builder accepts a `receiptDestination` parameter:

```typescript
const tx = buildPayAndProveTx(config, {
  sender: humanWallet,
  recipient: seller,
  receiptDestination: aiAgentAddress,  // agent gets the receipt
  // ...
});
```

**Why this is correct:**

- **Agent delegation**: The human pays, but their AI agent needs the receipt for SEAL decryption. The human doesn't want to give their wallet keys to the agent. `receiptDestination` solves this cleanly — human authorizes the payment, agent receives the proof.
- **Custodial patterns**: A service that pays on behalf of users can route receipts directly to end-user addresses.
- **On-chain composition**: A smart contract can be the `receiptDestination`, enabling protocol-level access control built on top of SweeFi receipts.

```
Human wallet  ──pays──>  Seller (gets funds)
     │
     └──receipt──>  AI Agent address  ──proves ownership──>  SEAL decrypt
```

The agent never touches funds. It only holds a receipt — a proof that someone paid. This is the separation of payment authorization (human) from access delegation (agent).

## Consequences

### Positive

- **SEAL-native design**: Receipts as bearer credentials map perfectly to SEAL's ownership-based access model. No translation layer needed.
- **Agent-first**: Delegated receipt destination enables the core SweeFi use case — AI agents that can prove payment without holding funds.
- **Composable**: `store` ability enables wrapping, marketplace listing, and cross-protocol integration.
- **Simple**: No access control lists, no revocation mechanisms, no admin-managed allowlists. Ownership IS access.

### Negative

- **Receipt theft = access theft**: If an attacker steals a receipt (via wallet compromise), they gain decryption access. Mitigated by: this is identical to the threat model for any owned object on Sui. Wallet security is the defense layer, not receipt-level access control.
- **No revocation**: Once a receipt is transferred, the original owner cannot revoke the new owner's access. This is intentional (bearer model) but may surprise users expecting "sharing" semantics. Content creators should understand: transferring a receipt = giving away your access permanently.
- **Self-pay receipt farming**: A user could generate many receipts cheaply (self-pay with 0 fee). If receipt existence is used as a "proof of genuine commerce" signal (e.g., reputation systems), this could be gamed. Mitigated by: receipts contain `amount` and `fee_amount` fields — systems can filter by meaningful payment thresholds.

## Security Audit Note (2026-02-21) — H-1 Finding & Fix

During adversarial security review (SECURITY-REVIEW-A.md), a HIGH severity finding
was identified: `seal_policy::check_policy` contradicted this ADR by checking
`ctx.sender() == receipt.buyer` (the original buyer's address). This locked decryption
to the original buyer forever, breaking:
- The bearer model described in §2 above
- The agent delegation pattern from §3
- SEAL's own ownership-based access model

**The fix** (2026-02-21): The `ctx.sender()` check was removed from `check_policy`.
Sui's object ownership model already enforces holder-only access — only the address
that owns the receipt object can include it as a transaction argument. The explicit
sender check was redundant AND wrong (it prevented legitimate transfers).

**Post-fix invariant**: `seal_approve` now enforces exactly two properties:
1. The caller presents a valid `EscrowReceipt` object (ownership-enforced by Sui)
2. The key_id starts with the receipt's `escrow_id` bytes (prefix check)

This matches the bearer model: possession = access. Transfer receipt = transfer access.

**Test coverage added**: `seal_policy_tests.move` — `test_seal_approve_bearer_transfer_new_holder_succeeds` (T-1) and `test_seal_approve_agent_delegation_succeeds` (T-2).

## References

- `contracts/sources/payment.move` — `PaymentReceipt` struct, `pay()` function
- `contracts/sources/escrow.move` — `EscrowReceipt` struct, `release()` function
- `contracts/sources/seal_policy.move` — `seal_approve()` ownership check (H-1 fix)
- `packages/sui/src/ptb/composable.ts` — `buildPayAndProveTx` with `receiptDestination`
- ADR-001: Composable PTB Pattern (the foundation this ADR builds on)
- `SECURITY-REVIEW-A.md` — Full adversarial security review (H-1 finding)
