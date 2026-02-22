# ADR-007: Prepaid Scheme Trust Model & Usage Proof Roadmap

**Status:** Accepted
**Date:** 2026-02-15
**Authors:** Session 128

## Context

The prepaid scheme (`prepaid.move`) enables deposit-based API access: an agent deposits funds into a shared `PrepaidBalance` object, makes API calls off-chain, and the provider claims earned funds by submitting a cumulative call count on-chain.

This scheme reduces 1,000 API calls from 1,000 on-chain transactions to 2 (deposit + batch-claim). However, it introduces a fundamental trust gap: **Move cannot verify that API calls actually happened.** The provider's `call_count` claim is unverifiable on-chain.

## Decision

### v0.1: Trust-Bounded (Economic Security)

The prepaid scheme ships with **economic mitigations**, not cryptographic proofs:

| Defense | How It Works | What It Bounds |
|---------|-------------|----------------|
| `rate_per_call` | Max base-units extractable per call | Per-call extraction rate |
| `max_calls` | Hard cap on total claims | Total extraction volume |
| Deposit ceiling | Agent only risks what they deposited | Absolute maximum loss |
| Small deposits + refills | $5 deposits, not $500 | Exposure per provider |
| Reputation | Dishonest providers lose repeat business | Long-term incentive |

**Acknowledged attack vectors:**

1. **Provider front-run drain** — Provider calls `claim(max_calls)` immediately after deposit. No enforced delay between deposit and first claim.
2. **No usage proof** — No oracle, attestation, or signed receipts linking API calls to claim counts. The off-chain → on-chain gap is entirely trust-based.
3. **Self-dealing** — `agent == provider` is allowed (valid self-service use case), but enables fake `PrepaidClaimed` events. Downstream systems must not treat these events as proof of real commerce without additional verification.

**Why this is acceptable for v0.1:** The prepaid scheme is designed for small, frequent deposits — analogous to a prepaid phone card or a gift card at a new restaurant. The agent's maximum loss is capped at the deposit amount. For the target use case (AI agents making $0.001-per-call API requests with $5-$50 deposits), economic security is sufficient.

### v0.2: Signed Usage Receipts (Cryptographic Security)

The provider signs each API response (or batch of responses) with a receipt that commits to the call count. The agent can submit these receipts on-chain as fraud proofs.

**Mechanism:**
```
1. Server signs: receipt = sign(provider_key, { balance_id, call_number, timestamp, response_hash })
2. Agent stores receipts locally (or on Walrus)
3. Provider claims: claim(balance, cumulative_count)
4. If disputed: Agent submits receipt proving actual count < claimed count
5. Move contract verifies signature, slashes provider's deposit (if bonded) or flags the balance
```

**Requirements:**
- Provider must have a known public key (registered on `PrepaidBalance` at deposit time)
- Receipt format standardized in s402 types
- Dispute window added to claim flow (optimistic — claims succeed unless challenged)

### v0.3+: TEE Attestation (Hardware Security)

For highest-assurance use cases, the API server runs inside a Trusted Execution Environment (Nautilus/SGX). The usage count is attested by hardware — no trust in the provider at all.

This is the endgame but requires Nautilus TEE infrastructure to mature on Sui.

## Consequences

### Positive
- v0.1 ships with honest, documented trust model (not fake "trustless" claims)
- Upgrade path is clear and incremental (economic → cryptographic → hardware)
- Each level is backward-compatible (signed receipts don't break unsigned flow)

### Negative
- v0.1 prepaid is unsuitable for high-value deposits with untrusted providers
- Documentation must clearly state the trust model to prevent misuse
- Signed receipts add complexity to the provider integration (v0.2 cost)

### Neutral
- The trust-bounded model is standard in Web2 (AWS bills you based on their metering — you trust them)
- Most real-world prepaid usage will be with established API providers where reputation suffices

## Known Limitations (v0.2)

These limitations are accepted and documented. They do not represent bugs in the
implementation but rather design constraints of single-receipt fraud proofs.

### L1: Semantically incomplete fraud proof (agent must submit their highest receipt)

The on-chain dispute check verifies:
```
claimed_calls < receipt_call_number < pending_claim_count
```

This proves the submitted receipt is valid and within the current pending batch.
It does **not** prove that the submitted receipt is the *highest* receipt the agent
holds. A dishonest agent could submit an early receipt (e.g., call #51) to dispute
a legitimate claim for 100 calls, even if the agent holds receipts up to call #100.

**System assumption:** Agents submit their highest available receipt when disputing.
This is the correct behavior for a rational agent (submit your best evidence).
A dishonest agent who submits an early receipt to cheat the provider violates the
terms of service and loses the ability to use that provider further.

**v0.3 fix:** Change receipt semantics so each receipt certifies a *cumulative*
count (`call_count_so_far`), not just a single call number. Then `dispute_claim`
can check: "provider signed a receipt certifying N cumulative calls, but now claims
M > N." This proof is unambiguous regardless of which receipt the agent submits.

### L2: No on-chain proof of provider pubkey ownership

The `provider_pubkey` stored in `PrepaidBalance` is provided by the agent at
deposit time. If the provider advertises an incorrect or invalid public key, the
dispute mechanism is silently disabled for that balance — all `dispute_claim`
calls will fail with `EInvalidFraudProof` because the signature cannot verify
against the wrong key.

**Required client-side flow before depositing with receipts:**

1. Request a signed challenge from the provider's API endpoint
2. Verify the signature using the provider's claimed public key
3. Only proceed to `deposit_with_receipts` if verification passes

```
Agent                         Provider
  │──── "sign this nonce" ──────▶│
  │◀─── signature ───────────────│
  │ verify(sig, nonce, pubkey)   │
  │ if valid → deposit_with_     │
  │            receipts(pubkey)  │
```

This challenge-response flow is not enforced on-chain (Move cannot query external
services) but should be implemented by all s402 client integrations.

## References

- `sweefi/contracts/sources/prepaid.move` — contract implementation with trust model comments
- Cetus $223M overflow — motivates u128 intermediate math in claim calculation
- Nautilus TEE documentation — endgame for hardware-attested usage proofs
- `SECURITY-REVIEW-V02.md` — v0.2 security audit findings and fixes
