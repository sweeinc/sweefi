# Behavioral Guarantees

This document specifies **edge-case behaviors** in SweeFi's Move contracts and facilitator that are intentional design choices. These behaviors are not bugs — they are load-bearing invariants. Changing them without understanding this document will break correctness or security.

> **For AI agents:** Before modifying any Move contract or facilitator logic, search this page for the affected module. If a behavior is listed here, it is intentional. Do not "fix" it.

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Semantic inconsistency that could cause silent fund loss or unlimited spending if misunderstood |
| **HIGH** | Safety invariant that integrators must know to build correct systems |
| **MEDIUM** | Non-obvious behavior that could cause confusion or incorrect off-chain logic |
| **INFO** | Documented for completeness; no correctness risk |

---

## Payment Module (`payment.move`)

### BG-01: 100% Fee Destroys Merchant Coin <Badge type="danger" text="HIGH" />

**Lines:** 204–209

When `fee_micro_pct = 1,000,000` (100%), the merchant's coin has value 0. The code calls `coin::destroy_zero(merchant_coin)` instead of transferring. The merchant receives nothing.

**Why it matters:** A misconfigured fee silently routes 100% of revenue to the fee recipient. There is no abort and no warning. Operators MUST validate `fee_micro_pct < 1,000,000` at deployment time.

**Applies to:** `escrow.move` has the identical pattern (BG-08 below).

### BG-02: Invoice Memo Is Always Empty <Badge type="info" text="INFO" />

**Line:** 326

The `PaymentReceipt` struct's `memo` field is hardcoded to `b""` (empty byte vector). This field exists in the struct but is not populated from any input parameter. Do not build reconciliation systems that depend on this field — it will always be empty.

---

## Streaming Module (`stream.move`)

### BG-03: Resume Time-Shifting Preserves Pre-Pause Accrual <Badge type="warning" text="MEDIUM" />

**Lines:** 438–446

When a paused stream is resumed, `last_claim_ms` is NOT set to `now`. Instead, it is shifted backward:

```
pre_pause_elapsed = paused_at_ms - last_claim_ms
last_claim_ms = now_ms - pre_pause_elapsed
```

This preserves accrual that occurred before the pause, making it claimable after resume. Off-chain reconciliation systems that track `last_claim_ms` will see it jump backward — this is intentional.

### BG-04: Saturation Guard on Resume (H-4 Fix) <Badge type="warning" text="MEDIUM" />

**Line:** 442

If `pre_pause_elapsed > now_ms` (pathological clock scenario), `last_claim_ms` saturates to 0 instead of underflowing. This is a defensive guard against clock manipulation. Do not remove this as "dead code."

### BG-05: Balance Diverges from Budget After Fee Deductions <Badge type="danger" text="HIGH" />

**Lines:** 323–328

When a claim is processed, fees are deducted from the coin balance, but `budget_remaining` is decremented by the gross (pre-fee) amount. Over time:

```
coin_balance < budget_remaining
```

**Impact:** An integrator checking `budget_remaining` to estimate "how much is left" will overestimate the actual available funds. The last claim will be smaller than expected because the coin balance is lower than `budget_remaining` suggests.

**Decision tree for integrators:**
```
To estimate remaining stream value:
├─ Want actual claimable amount → read coin balance (authoritative)
├─ Want remaining budget capacity → read budget_remaining
└─ These values WILL diverge for streams with fee_micro_pct > 0
```

### BG-06: Deposit Constrained by Budget Cap <Badge type="info" text="INFO" />

**Line:** 181

The initial deposit amount is checked against `budget_cap`. If `deposit > budget_cap`, the transaction aborts. You cannot create a stream with a deposit larger than its cap.

### BG-07: Top-Up Blocked on Exhausted Streams <Badge type="warning" text="MEDIUM" />

**Lines:** 716–717

If a stream's `budget_remaining` is 0 (i.e., `total_claimed >= budget_cap`), `top_up()` aborts with `EBudgetCapExceeded`. An exhausted stream is permanently non-refillable — you must create a new one. Funds remaining in the coin balance (due to BG-05 fee divergence) can only be recovered via `close()` / `refund()`.

---

## Escrow Module (`escrow.move`)

### BG-08: 100% Fee Destroys Seller Coin <Badge type="danger" text="HIGH" />

**Lines:** 316–323

Same pattern as BG-01. When `fee_micro_pct = 1,000,000`, the seller receives nothing and the code calls `coin::destroy_zero()`. The entire escrow value goes to `fee_recipient`.

### BG-09: Buyer Can Release After Deadline <Badge type="warning" text="MEDIUM" />

**Line:** 289

`release()` has NO deadline check. A buyer can release funds to the seller at any time — even years after the deadline. This is intentional: buyer satisfaction has no time limit.

**Asymmetry:** `dispute()` IS deadline-gated (BG-10 below). This means:
- Before deadline: buyer can release or dispute
- After deadline: buyer can only release; anyone can refund (permissionless)

### BG-10: Dispute Blocked After Deadline <Badge type="warning" text="MEDIUM" />

**Line:** 475

`dispute()` requires `clock_ms < deadline_ms`. Once the deadline passes, disputes are impossible. The only remaining actions are `release()` (by buyer) or permissionless `refund()`.

**UI implication:** Do not show a "dispute" button after the deadline — it will produce confusing abort errors.

---

## Prepaid Module (`prepaid.move`)

### BG-11: Finalize Withdrawal Blocked During Pending Claim <Badge type="danger" text="HIGH" />

**Line:** 709

If there is a pending (unfinalized) claim on the balance, the provider cannot finalize a withdrawal. This creates a potential interaction:

```
Agent submits claim → Provider requests withdrawal → Neither can complete
Resolution: claim must be finalized or dispute window must pass first
```

**Grief vector:** A malicious agent could continuously submit claims just before withdrawal finalization, effectively blocking the provider. The dispute window provides a time-bound resolution.

### BG-12: Withdrawal Delay Must Exceed Dispute Window <Badge type="danger" text="HIGH" />

**Line:** 358

When creating a PrepaidBalance: `withdrawal_delay_ms >= dispute_window_ms`. This ensures the agent always has time to dispute a withdrawal before it finalizes.

**Why this matters:** Without this constraint, a provider could set a 1-second withdrawal delay with a 24-hour dispute window — the agent would never have time to dispute before funds are gone.

### BG-13: Disputed Balance Allows Immediate Agent Withdrawal <Badge type="danger" text="HIGH" />

**Lines:** 912–962

When a balance is in `STATE_DISPUTED`, the agent can call `withdraw_disputed()` to withdraw remaining funds **immediately** — bypassing the normal `withdrawal_delay_ms` waiting period entirely.

**Game theory impact:** A provider disputing a balance gives the agent a fast-exit path. Providers should understand this before initiating disputes.

---

## Mandate Module (`mandate.move`)

### BG-14: Zero-Amount Validate Is a Valid No-Op <Badge type="info" text="INFO" />

**Lines:** 155–162

Calling `validate_and_spend(amount = 0)` passes all checks and increments `total_spent` by 0. The revocation check still runs. This can be used as a "ping" to check mandate liveness without spending.

### BG-15: Idempotent Revocation <Badge type="info" text="INFO" />

**Line:** 190

Revoking an already-revoked mandate is a no-op. The function adds the mandate ID to the revocation registry; if already present, it silently succeeds. Do not add client-side dedup logic — the contract handles it.

### BG-16: Any Holder Can Destroy a Mandate <Badge type="warning" text="MEDIUM" />

**Lines:** 215–218

`destroy_held()` takes a `Mandate` by value and destroys it. Since `Mandate` has `key + store`, anyone who owns the object can call this. There is no check for original grantor or delegate. Possession equals destruction rights. This is consistent with the bearer model.

---

## Agent Mandate Module (`agent_mandate.move`)

### BG-17: `max_total=0` Means UNLIMITED <Badge type="danger" text="CRITICAL" />

**Line:** 279

In `agent_mandate.move`, when `max_total = 0`, the total spending check is **skipped entirely**, meaning unlimited spending.

**This is the OPPOSITE of basic `mandate.move`**, where `max_total = 0` means zero budget (the check is unconditional at line 159).

```
CRITICAL — Semantic inconsistency between modules:
├─ mandate.move:       max_total = 0 → zero budget (cannot spend anything)
└─ agent_mandate.move: max_total = 0 → unlimited  (can spend everything)
```

**Risk:** An integrator familiar with basic mandates who sets `max_total = 0` on an AgentMandate expecting "no spending" will instead create an **unlimited** mandate.

### BG-18: Cap Updates Blocked Below Current Spent <Badge type="warning" text="MEDIUM" />

**Lines:** 341–343

When updating daily, weekly, or total spending caps via `update_caps()`, the new limit cannot be set below the current spent amount. Example: if `daily_spent = 500`, you cannot set `daily_limit = 300` — the transaction aborts.

**Workaround:** To emergency-reduce spending authority mid-period, revoke the mandate entirely and create a new one with lower caps.

---

## Admin Module (`admin.move`)

### BG-19: Burning AdminCap Requires Protocol Unpaused <Badge type="danger" text="HIGH" />

**Line:** 138

`burn_admin_cap()` asserts `!protocol_state.paused` before proceeding. You cannot renounce admin privileges while the protocol is paused.

**Why:** Without this interlock, an admin could accidentally burn the only key that could unpause the system, permanently locking the protocol in a paused state with no recovery path. This is a critical safety mechanism.

---

## Facilitator (`exact/facilitator.ts`)

### BG-20: Gas Budget Enforcement <Badge type="danger" text="HIGH" />

**Lines:** 156–163

When the facilitator detects a gas-sponsored transaction, it enforces:
1. Gas budget MUST NOT be zero (prevents undefined-budget bypass)
2. Gas budget MUST NOT exceed `maxSponsorGasBudget` (default: 10,000,000 MIST = 0.01 SUI)

Violations return a settlement failure, not an RPC abort. Clients that rely on auto-budget (no explicit `setGasBudget()`) will fail with "Gas budget is zero or missing."

### BG-21: Double Verification in Settle (TOCTOU Defense) <Badge type="warning" text="MEDIUM" />

**Line:** 133

`settle()` calls `this.verify()` as its first step before broadcasting. This means every settlement performs two dry-run simulations. This is defense-in-depth against time-of-check-time-of-use attacks where on-chain state changes between verification and settlement.

**Performance cost:** ~400ms extra latency per settlement. Do not remove to "optimize" — you would introduce a security vulnerability.

### BG-22: Dedup Cache Evicts at 80% Capacity <Badge type="info" text="INFO" />

**Line:** 65 (`dedup.ts`)

The dedup cache evicts expired entries when it reaches 80% of `maxEntries`. Eviction is triggered on insertion, not on a timer. Under sustained load with unique payloads, the cache may oscillate near capacity.

---

## Quick Reference Table

| ID | Module | Behavior | Severity |
|----|--------|----------|----------|
| BG-01 | payment | 100% fee destroys merchant coin | HIGH |
| BG-02 | payment | Invoice memo always empty | INFO |
| BG-03 | stream | Resume time-shifts `last_claim_ms` backward | MEDIUM |
| BG-04 | stream | Saturation guard caps at 0 on resume | MEDIUM |
| BG-05 | stream | Balance diverges from budget after fees | HIGH |
| BG-06 | stream | Deposit constrained by budget cap | INFO |
| BG-07 | stream | Top-up blocked on exhausted streams | MEDIUM |
| BG-08 | escrow | 100% fee destroys seller coin | HIGH |
| BG-09 | escrow | Buyer can release after deadline | MEDIUM |
| BG-10 | escrow | Dispute blocked after deadline | MEDIUM |
| BG-11 | prepaid | Withdrawal blocked during pending claim | HIGH |
| BG-12 | prepaid | Withdrawal delay >= dispute window | HIGH |
| BG-13 | prepaid | Disputed balance: immediate agent withdrawal | HIGH |
| BG-14 | mandate | Zero-amount validate is valid no-op | INFO |
| BG-15 | mandate | Idempotent revocation | INFO |
| BG-16 | mandate | Any holder can destroy mandate | MEDIUM |
| BG-17 | agent_mandate | `max_total=0` means UNLIMITED | **CRITICAL** |
| BG-18 | agent_mandate | Cap updates blocked below current spent | MEDIUM |
| BG-19 | admin | Burn AdminCap requires unpaused | HIGH |
| BG-20 | facilitator | Gas budget zero/over-cap rejection | HIGH |
| BG-21 | facilitator | Double verification (TOCTOU defense) | MEDIUM |
| BG-22 | facilitator | Dedup evicts at 80% capacity | INFO |
