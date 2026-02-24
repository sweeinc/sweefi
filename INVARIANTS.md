# SweeFi — Invariants & Proofs

> *"If you think you know something but don't write it down, you only think you know it."* — Leslie Lamport
>
> This document contains the formal safety properties of SweeFi's payment protocol.
> Every proof was written before or alongside code — not after. When a proof breaks,
> the code has a bug.

---

## Notation

- **Safety property**: Something bad NEVER happens
- **Liveness property**: Something good EVENTUALLY happens
- **Invariant**: A property that holds at EVERY state of the system
- `∎` marks the end of a proof
- `⚠️` marks a known limitation or assumption

---

## P1. Prepaid Solvency (Safety)

**Statement**: An agent can never lose more funds than they deposited into a PrepaidBalance.

**Formally**: For all PrepaidBalance objects `B`:
```
B.funds_withdrawn + B.funds_claimed_by_provider ≤ B.initial_deposit
```

**Proof**:

```
Let B be a PrepaidBalance with initial_deposit D, rate_per_call R, max_calls M.

By construction: D ≥ R × M  (enforced in deposit_with_receipts, line 319)

The only operations that remove funds from B are:
  (a) Provider claims: claim() transfers (claimed_count × R) to provider
  (b) Agent withdraws: finalize_withdrawal() transfers remaining balance to agent

For (a): The contract enforces
  new_claimed_calls ≤ max_calls                    (line 450)
  transfer_amount = (new_claimed_calls - old_claimed_calls) × R

  Maximum total claimed = max_calls × R ≤ D        (from deposit constraint)

For (b): finalize_withdrawal transfers balance.value() which is
  D - (total_claimed × R)

Sum of all removals:
  (total_claimed × R) + (D - total_claimed × R) = D

Therefore: total funds removed = D. Never more.  ∎
```

**Corollary**: The provider can never extract more than `max_calls × rate_per_call`.

---

## P2. Prepaid Dispute Bounds (Safety)

**Statement**: A valid fraud proof must reference a receipt from the CURRENT unsettled batch, not a previously settled batch.

**Formally**: For dispute_claim to succeed:
```
B.claimed_calls < receipt_call_number < B.pending_claim_count
```

**✅ FIXED (F1 from Security Review v0.2)**: Both bounds are now enforced in `prepaid.move` (lines 620–631).

**Proof that the original bug existed** (by counterexample):

```
Without the lower bound, an agent could replay a settled receipt:

1. B.claimed_calls = 50 (batch 1 settled)
2. Provider submits claim(100) → B.pending_claim_count = 100
3. Agent submits dispute with receipt_call_number = 20

Without lower bound:
  20 < 100?  YES  (upper bound passes)
  20 > 50?   NOT CHECKED  ← the missing guard

Receipt #20 is from batch 1 (already settled and paid for).
The dispute would succeed on a receipt the provider already legitimately earned.
Provider would lose the ENTIRE current batch.  ∎ (bug confirmed pre-fix)
```

**Fix applied** (prepaid.move line 628):
```move
// F1: Receipt must be from the current pending batch, not a previously
// settled one.
assert!(receipt_call_number > balance.claimed_calls, EInvalidFraudProof);
```

**Proof that the fix is sufficient**:

```
With both bounds, a valid dispute receipt must satisfy:
  claimed_calls < receipt_call_number < pending_claim_count

This restricts receipts to the CURRENT unsettled window.
A receipt from a settled batch has call_number ≤ claimed_calls → rejected.
A receipt for a call not yet claimed has call_number ≥ pending_claim_count → rejected.

The only valid receipts are from the current batch, proving the provider
claimed more calls than they actually signed receipts for.  ∎
```

---

## P3. Mandate Spending Bounds (Safety)

**Statement**: No agent transaction can exceed its mandate's per-transaction limit or lifetime budget.

**Formally**: For all transactions T executed under mandate M:
```
T.amount ≤ M.per_tx_limit
AND
sum(all T under M) ≤ M.lifetime_cap
```

**Proof**:

```
mandate.move checks at execution time (Move consensus layer):

  1. assert!(tx.amount <= mandate.per_tx_limit, EExceedsPerTxLimit)
  2. mandate.total_spent += tx.amount
     assert!(mandate.total_spent <= mandate.lifetime_cap, EExceedsLifetimeCap)

These checks run as part of the Move transaction execution.
The LLM (agent intelligence) is NEVER in this execution path.

Therefore: Even if the agent is fully compromised (jailbroken, manipulated),
it cannot construct a PTB that bypasses these checks because Move validators
reject the transaction at consensus.

Note: This is STRUCTURAL safety, not BEHAVIORAL safety.
The agent doesn't need to "choose" to obey the limit.
The chain REJECTS violations regardless of the agent's intent.  ∎
```

**⚠️ Known limitation (Splitting Attack)**: An agent can make 100 transactions of $49 each to circumvent a $50 per-tx limit. Mitigation: the `lifetime_cap` bounds total spending. Design mandates with `lifetime_cap = N × per_tx_limit` for appropriate N.

---

## P4. No Double Settlement (Safety)

**Statement**: A payment can never be settled more than once.

**Formally**: For all payment payloads P, at most one receipt R is minted on-chain.

**Proof (exact scheme)**:

```
payment::pay() is a Move function that:
  1. Transfers coins from sender to payTo address
  2. Mints a PaymentReceipt NFT

In Sui's execution model, a PTB either fully succeeds or fully reverts.
A duplicate PTB with the same inputs is a NEW transaction (different digest).

The s402 facilitator prevents replay via:
  - In-flight dedup Set (H-2 hardening patch): identical payloads
    within a processing window are rejected before reaching the chain
  - On-chain: Each PTB has a unique digest. Submitting the exact same
    PTB twice results in a "transaction already executed" error from validators.

Therefore: Each payment payload produces at most one on-chain receipt.  ∎
```

**Proof (prepaid scheme)**:

```
For prepaid, settlement is via claim():
  1. Provider calls claim(new_count)
  2. Contract checks new_count > claimed_calls
  3. Transfers (new_count - claimed_calls) × rate_per_call to provider
  4. Updates claimed_calls = new_count

A second claim(new_count) with the SAME count:
  new_count > claimed_calls?  → new_count > new_count → FALSE
  → Transaction aborts with EInvalidClaimCount

Therefore: Each call is paid for exactly once.  ∎
```

---

## P5. Escrow Termination (Liveness)

**Statement**: Every escrow eventually resolves — funds are never permanently locked.

**Formally**: For all Escrow objects E, there exists a finite time T where E is destroyed and funds are distributed.

**Proof**:

```
An Escrow E has three resolution paths:
  (a) release(): Provider delivers, agent confirms → funds to provider
  (b) refund(): Deadline passes without delivery → funds to agent
  (c) arbiter_resolve(): Arbiter decides → funds to winner

For (b): E has a deadline_ms. After deadline_ms:
  - Anyone can call refund()
  - The contract checks clock.timestamp_ms > E.deadline_ms
  - Funds return to agent, E is destroyed

Therefore: Even if provider disappears and arbiter is unavailable,
path (b) triggers after the deadline. No escrow is permanent.

⚠️ Assumption: Sui validators continue to produce blocks (chain liveness).
If the chain halts, no on-chain state can change. This is a shared
assumption across ALL blockchain protocols.  ∎
```

---

## P6. Stream Budget Cap (Safety)

**Statement**: A payment stream never exceeds its maximum budget, regardless of tick timing.

**Formally**: For all Stream objects S:
```
total_streamed ≤ S.max_amount
```

**Proof**:

```
stream.move tick() computes:
  elapsed = min(clock.timestamp_ms, S.end_ms) - S.last_tick_ms
  amount_due = elapsed × S.rate_per_ms
  actual_transfer = min(amount_due, S.remaining)

where S.remaining = S.max_amount - S.total_streamed

Even if tick() is called once after the stream ends (worst case):
  elapsed = S.end_ms - S.start_ms = S.duration
  amount_due = S.duration × S.rate_per_ms = S.max_amount
  actual_transfer = min(S.max_amount, S.remaining)

If S.total_streamed = 0 (no prior ticks):
  actual_transfer = min(S.max_amount, S.max_amount) = S.max_amount ✓

If S.total_streamed > 0 (some prior ticks):
  actual_transfer = min(amount_due, S.max_amount - S.total_streamed)
  S.total_streamed + actual_transfer ≤ S.max_amount ✓

The `min` guard ensures the cap is never exceeded regardless of
tick frequency, timing, or accumulated rounding.  ∎
```

---

## P7. PTB Atomicity — No Orphaned States (Safety)

**Statement**: A payment either fully settles (on-chain receipt exists, funds transferred) or fully reverts (no state change). There is no intermediate state where funds are locked but no receipt exists.

**Proof**:

```
Sui Programmable Transaction Blocks execute atomically.
A PTB containing:
  Command 1: payment::pay(coins, payTo, amount)
  Command 2: (other operations using the receipt)

Either ALL commands succeed → receipt minted, funds transferred
Or ANY command fails → entire PTB reverts, no state changes

There is no "verify step" followed by a separate "settle step"
with a temporal gap between them (unlike EVM x402 which has this gap).

In s402 on Sui:
  verify + settle happen in the SAME PTB
  → atomic by Sui protocol guarantee
  → no orphaned states possible  ∎

⚠️ Contrast with EVM x402:
  EVM x402 has verify (off-chain) → settle (on-chain) with a temporal gap.
  During this gap, the payment is "verified but not settled" — an orphaned state.
  Network congestion, gas price spikes, or nonce issues can cause verify without settle.
  This is architecturally impossible on Sui.
```

---

## P8. SEAL Content Gating (Safety)

**Statement**: Encrypted content remains inaccessible until a valid payment receipt exists on-chain.

**Proof**:

```
SEAL threshold encryption requires k-of-n key servers to release the decryption key.
Each key server checks seal_policy.move:
  - A SealPolicy receipt exists with the correct policy_id
  - The receipt was created by the pay() function (not forged)

seal_policy::pay() requires a valid payment (coins transferred + amount verified)
before minting the SealPolicy receipt.

The decryption key is NEVER transmitted to the client until ALL of:
  1. Payment receipt exists on-chain (verified by key servers)
  2. k-of-n key servers independently verify (threshold check)
  3. Key shares are combined client-side (cryptographic reconstruction)

Without the receipt, key servers refuse to release shares.
Without k shares, the client cannot reconstruct the key.
Without the key, the ciphertext is computationally infeasible to decrypt
(AES-256-GCM security assumption).

Therefore: Content is inaccessible until payment is verified on-chain.  ∎
```

---

## P9. Facilitator Non-Custodial Property (Safety)

**Statement**: The facilitator never holds custody of user funds and cannot execute unauthorized transactions.

**Proof**:

```
The facilitator's role in the s402 flow:
  1. Receive payment payload from client
  2. Verify the payload (signature, balance, expiry)
  3. Submit the PTB to Sui for execution

The facilitator DOES NOT:
  - Hold private keys for user wallets
  - Modify the PTB contents (would invalidate the signature)
  - Hold funds in escrow between verify and settle

The PTB is signed by the AGENT's private key, not the facilitator's.
The facilitator is a relay — it submits pre-signed transactions.

If the facilitator is compromised:
  - It cannot forge transactions (no private key)
  - It cannot redirect funds (payTo is in the signed payload)
  - It can only refuse to submit (denial of service, not theft)

The worst case is liveness failure (facilitator goes down),
not safety failure (funds stolen).

⚠️ For self-hosted facilitators: The owner of the facilitator and the provider
are often the same entity. This doesn't change the proof — the facilitator
still cannot modify signed payloads.  ∎
```

---

## P10. Withdrawal Delay Soundness (Safety)

**Statement**: An agent's withdrawal cannot race ahead of a provider's legitimate claim.

**Current implementation**: `finalize_withdrawal` checks `pending_claim_count == 0`.

**⚠️ KNOWN ISSUE (F4)**: No constraint enforces `withdrawal_delay_ms ≥ dispute_window_ms`.

**Proof that the current design is SAFE (funds cannot be stolen) but has a UX gap**:

```
Case 1: No pending claims during withdrawal delay.
  Agent requests withdrawal → waits withdrawal_delay_ms → finalizes.
  No claims submitted → pending_claim_count == 0 → withdrawal succeeds.
  Safe. ✓

Case 2: Provider submits claim during withdrawal delay.
  Agent requests withdrawal at T=0.
  Provider submits claim at T=k (where k < withdrawal_delay_ms).
  At T=withdrawal_delay_ms, agent calls finalize_withdrawal.
  pending_claim_count > 0 → BLOCKED (EPendingClaimExists).

  Agent must wait for dispute_window_ms to expire, then:
    - If honest: finalize_claim runs, pending_claim_count = 0, then withdraw
    - If dispute: dispute_claim, then withdraw_disputed

  Effective delay: withdrawal_delay_ms + dispute_window_ms

  This is SAFE (no funds lost) but SURPRISING to the user.
  Fix: enforce withdrawal_delay_ms ≥ dispute_window_ms at deposit time.  ∎
```

---

## Composition Theorem

**Statement**: The five payment schemes compose safely within a single PTB.

**Proof sketch**:

```
Each scheme operates on its own Sui objects:
  - exact: no shared objects (owned coins only)
  - prepaid: PrepaidBalance (shared, one per agent-provider pair)
  - stream: Stream (shared, one per stream)
  - escrow: Escrow (shared, one per escrow)
  - unlock: Escrow + SealPolicy receipt

Sui's object model guarantees:
  - Owned objects have single-writer semantics (no contention)
  - Shared objects are serialized per-object (no cross-object races)
  - A PTB touching objects A and B is atomic across both

Therefore: A PTB that performs an exact payment AND creates a stream
is atomic and safe — the exact payment and stream creation either
BOTH succeed or BOTH revert. No partial state.

⚠️ Limit: A single PTB cannot touch more than ~1024 commands or exceed
the gas budget. Complex multi-scheme compositions may need multiple PTBs,
which breaks atomicity between them.  ∎
```

---

## Summary Table

| ID | Property | Type | Status | Proven? |
|----|----------|------|--------|---------|
| P1 | Prepaid solvency | Safety | ✅ Holds | Yes |
| P2 | Dispute bounds | Safety | ✅ Fixed (F1) | Proof found the bug; fix verified |
| P3 | Mandate spending | Safety | ✅ Holds | Yes (structural) |
| P4 | No double-settle | Safety | ✅ Holds | Yes |
| P5 | Escrow termination | Liveness | ✅ Holds | Yes (with chain liveness assumption) |
| P6 | Stream budget cap | Safety | ✅ Holds | Yes |
| P7 | PTB atomicity | Safety | ✅ Holds | Yes (Sui protocol guarantee) |
| P8 | SEAL content gating | Safety | ✅ Holds | Yes (with crypto assumptions) |
| P9 | Facilitator non-custodial | Safety | ✅ Holds | Yes |
| P10 | Withdrawal delay | Safety | ⚠️ UX gap (F4) | Safe but surprising |

---

## Assumptions

These proofs depend on the following assumptions:

1. **Sui chain liveness**: Validators continue producing blocks
2. **Move soundness**: The Move VM correctly enforces type safety and abort conditions
3. **Cryptographic hardness**: Ed25519 signatures cannot be forged; AES-256-GCM is secure
4. **SEAL threshold**: At least k of n key servers are honest and available
5. **Clock accuracy**: `sui::clock::Clock` provides monotonically increasing timestamps
