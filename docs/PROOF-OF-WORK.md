# SweeFi Proof of Work

Last verified: 2026-03-10

## Verification Commands

```bash
# TypeScript workspace tests (offline-safe default lane)
pnpm -r test

# Move contract tests
cd contracts && sui move test
```

## Verified Test Counts

- TypeScript tests: **1,228 passing**
  - `@sweefi/sui`: 550
  - `@sweefi/cli`: 238
  - `@sweefi/mcp`: 222
  - `@sweefi/facilitator`: 91
  - `@sweefi/ap2-adapter`: 52
  - `@sweefi/solana`: 40
  - `@sweefi/ui-core`: 13
  - `@sweefi/react`: 12
  - `@sweefi/vue`: 10
  - `@sweefi/server`: 0 (integration-only tests — no offline unit tests)
- Move tests: **426 functions** (all passing)
- **Grand total: 1,654 tests**
- **Hardening audit**: [HARDENING-AUDIT-2026-03-10.md](HARDENING-AUDIT-2026-03-10.md) — DO-178B MC/DC, mutation testing, metamorphic verification

## Hardening Stories

The March 2026 hardening session applied DO-178B aviation-grade techniques (MC/DC condition coverage, mutation testing, metamorphic verification) to the full SweeFi stack. These methods are standard in avionics and safety-critical systems but rare in blockchain development. They found bugs that three prior audit waves missed.

### The Option Type Bug (F-01, F-02 — CRITICAL)

**What was found:** Both `buildCreateMandateTx` and `buildCreateAgentMandateTx` serialized the `expiresAtMs` parameter as a raw `u64`, but the Move contract expects `Option<u64>`. This caused BCS deserialization failure at transaction time — the mandate creation silently failed on-chain.

**Why it matters:** Mandates are SweeFi's core authorization primitive. Every AI agent spending on behalf of a user creates a mandate. If mandate creation silently fails, the agent has no spending authority and the user sees no error — just nothing happening. In production, this would mean dead agents on every mandate with an expiration date.

**How it was found:** MC/DC condition testing requires every boolean condition to independently affect the outcome. When testing the `expiresAtMs` parameter, the MC/DC matrix demanded both the `null` path (no expiration) and the `bigint` path (with expiration) be exercised and verified against the Move contract's type signature. The type mismatch surfaced immediately.

**Why previous testing missed it:** Prior tests either omitted the expiration parameter (defaulting to `null`, which happened to serialize correctly as `Option::None`) or tested at the TypeScript level without verifying BCS serialization against the Move ABI. The bug only manifests when a non-null expiration is provided AND the transaction is submitted on-chain.

### The Escrow Deadline Lockup Attack (Mutation #11 — HIGH)

**What was found:** In the escrow module's `dispute()` function, the boundary check `now < deadline` could be mutated to `now <= deadline` without any test failing. This means a seller could call `dispute()` at the exact deadline timestamp, which triggers the grace period extension and locks buyer funds for up to 30 additional days beyond the agreed deadline.

**Why it matters:** This is an economic griefing attack. A malicious seller who knows they'll lose an escrow can wait until the exact deadline and dispute, trapping the buyer's funds in limbo. The buyer gets their money eventually, but 30 days of locked capital is real economic damage — and in DeFi, time-value of locked funds matters.

**How it was found:** Mutation testing systematically flips every boundary comparison (`<` to `<=`, `>=` to `>`, etc.) and checks whether existing tests detect the change. When the `<` was mutated to `<=` in `dispute()`, zero tests failed — meaning no test exercised the exact-deadline boundary. The kill test `test_mutation_kill_dispute_at_exact_deadline_fails` was written to verify that disputing AT the deadline is correctly rejected.

**Why previous testing missed it:** Conventional tests used deadlines comfortably in the future or the past. Nobody wrote a test for the exact boundary tick. This is precisely the class of bug that mutation testing is designed to surface — off-by-one errors in boundary conditions that only matter under adversarial conditions.

### Metamorphic Testing — 44 Mathematical Invariants

**What was verified:** Rather than testing individual functions with specific inputs and expected outputs, metamorphic testing verifies mathematical properties that must hold across ALL inputs:

- **Fee proportionality:** Doubling the payment amount doubles the fee within one unit of rounding error. Verified across random amounts from dust to `u64::MAX`.
- **Fee conservation:** `merchant_amount + protocol_fee === total_amount` for every split. No tokens created or destroyed during fee calculation.
- **Stream accrual monotonicity:** Claimable amount never decreases as time advances (for a non-paused stream).
- **Amount parsing roundtrip:** `parseAmount(String(n)) === n` for all representable values — powers of 2, boundary values, random samples.
- **Fee dust invariant:** When the fee rounds to zero, the full amount goes to the merchant. No empty coin objects created on-chain.

**Why it matters:** Traditional tests check "does `calculateFee(1000, 250)` return `25`?" Metamorphic tests check "does the fee function satisfy the mathematical properties that make it correct for ALL inputs?" This is the difference between checking examples and proving properties. A fee function could pass thousands of example-based tests while violating proportionality at specific boundary values.

**How it was found:** 44 metamorphic test relations were derived from the mathematical specifications in the Move contracts and ADR-003 (fee calculation design). Each relation encodes a property that must hold if the implementation is correct, regardless of specific input values.

### The Numbers

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Total tests | 1,102 | 1,654 | +552 |
| Move tests | 293 | 426 | +133 |
| TypeScript tests | ~810 | 1,228 | +418 |
| Mutation survivors | 12 | 0 | All killed |
| Findings fixed | — | 11 | 2 CRITICAL, 4 MEDIUM, 5 LOW |

Testing techniques applied: MC/DC condition coverage, mutation testing (12 boundary mutants), metamorphic verification (44 invariants), property-based testing (35 randomized), input fuzzing (98 MCP tool inputs), cross-layer type verification (Move ABI vs TypeScript serialization).

Full audit report: [HARDENING-AUDIT-2026-03-10.md](HARDENING-AUDIT-2026-03-10.md)

## Live Testnet Transactions (v11 — current package)

All transactions below call the v11 Move contracts at `0xb83e5036...9ac5`.

| Transaction | Type | Explorer Link |
|------------|------|---------------|
| Direct payment | `payment::pay` | [`Gts9F3gX...`](https://suiscan.xyz/testnet/tx/Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK) |
| Stream creation | `stream::create` | [`GDo8g5Yu...`](https://suiscan.xyz/testnet/tx/GDo8g5Yu1X1zCdaLTtEVCqxeWJqkDDyoHjdGP5TLvkhf) |
| Escrow creation | `escrow::create` | [`EcYFG3FT...`](https://suiscan.xyz/testnet/tx/EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR) |

## Live Objects

| Object | Type | Explorer Link |
|--------|------|---------------|
| StreamingMeter | `stream::StreamingMeter<SUI>` | [`0xbd8da3...`](https://suiscan.xyz/testnet/object/0xbd8da3c7a69d1d10ee4dcada29c39272f1801349fce03fbb679d94ee231f08a3) |
| Escrow | `escrow::Escrow<SUI>` | [`0xe13315...`](https://suiscan.xyz/testnet/object/0xe1331575df1a93fe11ed1758ee7110c0a581f98d7ff889d40e23b6fa2a67b531) |
| PaymentReceipt | `payment::PaymentReceipt` | [`0xffd2c8...`](https://suiscan.xyz/testnet/object/0xffd2c8e26ebd0a69ad89802eb6a57ad92da2b5690befd529b2a96d99634db00f) |

## Current Testnet Package

**v11 (live — 11th testnet deploy, auto-unpause + MC/DC):**
- Package ID: `0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5`
- AdminCap: `0xdba70844f06c46dd4f4a331bcf9ffa234cfd1b9c9d7449719a5311112fa946dc`
- ProtocolState: `0x75f4eef7ad9cdffda4278c9677a15d4993393e16cc901dc2fe26befe9e79808b`
- UpgradeCap: `0xb160234f12c12e4c1a98010569e18fcd9a444a5eec3c15e3b2eedb0f691d000f`
- Explorer: <https://suiscan.xyz/testnet/object/0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5>
- Modules: `payment`, `stream`, `escrow`, `seal_policy`, `mandate`, `agent_mandate`, `prepaid`, `admin`, `math`, `identity`
