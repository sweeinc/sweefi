# Hardening Audit: DO-178B MC/DC + Mutation + Metamorphic Testing

**Reviewer:** Claude Opus 4.6 (aviation-grade hardening role)
**Date:** 2026-03-10
**Scope:** Full-stack hardening — 10 Move modules, 10 TS packages
**Method:** MC/DC coverage, cross-layer verification, adversarial scenarios, property-based testing, mutation testing, metamorphic testing
**Published:** `@sweefi/sui@0.2.5`, `@sweefi/mcp@0.1.3`

---

## Executive Summary

Cross-layer type verification found 2 CRITICAL bugs (Option<u64> serialization mismatch) that survived 3 prior audit waves. Mutation testing found 12 boundary mutants surviving in Move contracts. All findings fixed, all tests green.

**Before → After:**
- Move tests: 293 → 426 (+133)
- TS tests: ~810 → 1,340 (+530)
- Total: ~1,103 → 1,766

---

## Findings

### CRITICAL

| ID | File | Title | Fix |
|----|------|-------|-----|
| F-01 | `ptb/mandate.ts` | `expiresAtMs` serialized as `u64` but Move expects `Option<u64>` — BCS deserialization failure at tx time | Changed to `tx.pure.option("u64", ...)`, TS type to `bigint \| null` |
| F-02 | `ptb/agent-mandate.ts` | Same Option<u64> mismatch in `buildCreateAgentMandateTx` | Same fix as F-01 |

### MEDIUM

| ID | File | Title | Fix |
|----|------|-------|-----|
| F-08 | `ptb/mandate.ts` | `buildMandatedPayTx` missing `assertPositive(amount)` — zero amount silently passed | Added `assertPositive` |
| F-09 | `ptb/agent-mandate.ts` | `buildAgentMandatedPayTx` missing `assertPositive(amount)` | Added `assertPositive` |
| S-01 | `s402/exact/client.ts` | `ExactSuiClientScheme.createPayment` accepted empty string amount (`BigInt("") === 0n`) | Added `totalAmount <= 0n` guard |
| S-02 | `s402/exact/client.ts` | Negative amount string passed through silently | Same guard as S-01 |

### LOW

| ID | File | Title | Fix |
|----|------|-------|-----|
| F-04 | `ptb/stream.ts` | `buildTopUpTx` missing `assertPositive(depositAmount)` | Added `assertPositive` |
| F-07 | `ptb/prepaid.ts` | `buildTopUpTx` missing `assertPositive(amount)` | Added `assertPositive` |
| F-01b | `ptb/payment.ts` | `buildPayInvoiceTx` missing `assertPositive(amount)` | Added `assertPositive` |
| MCP-01 | `mcp/format.ts` | 13 missing Move error codes in `humanizeError` | Added all codes (111, 214, 215, 503, 614-622) |
| MCP-02 | `mcp/format.ts` | `parseAmount` error messages include full input (log bloat vector) | Truncate at 100 chars |

---

## Mutation Testing Results

12 surviving mutants found and killed (all boundary `>=`/`<=` vs `>`/`<` mutations):

| # | Module | Mutation | Risk | Kill Test |
|---|--------|----------|------|-----------|
| 1 | prepaid | `cumulative <= max_calls` → `<` | Agent loses final prepaid call | `test_mutation_kill_claim_at_exact_max_calls` |
| 2 | prepaid | `gross <= deposited` → `<` | Can't claim exact remaining | `test_mutation_kill_claim_exactly_remaining_balance` |
| 3 | prepaid | `amount >= MIN` → `>` | Rejects exact MIN_DEPOSIT | `test_mutation_kill_deposit_exact_min_deposit` |
| 4 | prepaid | `delay >= MIN_DELAY` → `>` | Rejects exact min delay | `test_mutation_kill_deposit_exact_min_withdrawal_delay` |
| 5 | prepaid | `delay <= MAX_DELAY` → `<` | Rejects exact max delay | `test_mutation_kill_deposit_exact_max_withdrawal_delay` |
| 6 | prepaid | `now >= requested + delay` → `>` | Can't finalize at exact expiry | `test_mutation_kill_finalize_withdrawal_at_exact_delay` |
| 7 | stream | `timeout >= MIN` → `>` | Rejects exact 1-day timeout | `test_mutation_kill_create_with_exact_min_timeout` |
| 8 | stream | `timeout <= MAX` → `<` | Rejects exact 30-day timeout | `test_mutation_kill_create_with_exact_max_timeout` |
| 9 | stream | `timeout >= MIN` (negative) | Accepts below-min timeout | `test_mutation_kill_create_timeout_one_below_min_fails` |
| 10 | stream | `timeout <= MAX` (negative) | Accepts above-max timeout | `test_mutation_kill_create_timeout_one_above_max_fails` |
| 11 | escrow | `now < deadline` → `<=` in dispute() | **Post-deadline lockup attack** — seller disputes at exact deadline, extends via grace period | `test_mutation_kill_dispute_at_exact_deadline_fails` |
| 12 | escrow | `deposit >= MIN` → `>` | Rejects exact MIN_DEPOSIT | `test_mutation_kill_create_exact_min_deposit` |

**Most dangerous:** #11 (escrow deadline). Mutating `<` to `<=` allows a seller to dispute at the exact deadline, which extends the lockup via grace period and could trap buyer funds for up to 30 days.

---

## Metamorphic Properties Verified (44 tests)

- Fee conversion identity: `bpsToMicroPercent(x) === x * 100` for all [0, 10000]
- Fee split conservation: `merchant + fee === total` for 50 random pairs + u64::MAX extremes
- Amount parsing roundtrip: `parseAmount(String(n)) === n` for powers of 2, boundaries, random values
- Memo encoding determinism: ASCII, emoji, ZWJ sequences, null bytes
- Micro-percent boundary: accepts [0, 1_000_000], rejects 1_000_001 and -1
- Option serialization: both null and bigint paths produce valid transactions
- Fee dust invariant: when fee rounds to 0, full amount goes to merchant (no empty coin)
- Fee scaling linearity and bounded rounding error

---

## Coverage Summary

| Module | MC/DC | Adversarial | Mutation Kill | Status |
|--------|-------|-------------|---------------|--------|
| math | Yes | — | 0 survivors | Complete |
| payment | Yes | — | 0 survivors | Complete |
| stream | Yes | Yes | 4 killed | Complete |
| prepaid | Yes | Yes | 6 killed | Complete |
| escrow | Yes | Yes | 2 killed | Complete |
| mandate | Yes | Yes | 0 survivors | Complete |
| agent_mandate | Yes | Yes | 0 survivors | Complete |
| admin | Yes | Yes | 0 survivors | Complete |
| identity | — | — | — | Low priority (no money) |
| seal_policy | — | Yes | 0 survivors | Low priority (no money) |

---

## New Test Files

| File | Tests | Category |
|------|-------|----------|
| `contracts/tests/*_tests.move` (9 files) | +133 | MC/DC, adversarial, mutation kill |
| `packages/sui/test/unit/pbt.test.ts` | 35 | Property-based testing |
| `packages/sui/test/unit/metamorphic.test.ts` | 44 | Metamorphic invariants |
| `packages/sui/test/unit/s402-robustness.test.ts` | 54 | Scheme adapter edge cases |
| `packages/sui/test/unit/ptb-validation.test.ts` | 72 | PTB builder validation |
| `packages/mcp/test/input-fuzzing.test.ts` | 98 | MCP tool input fuzzing |
| `packages/facilitator/test/security-hardening.test.ts` | 28 | Facilitator security |
