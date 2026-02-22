# ADR-002: Batch Claims & Gas Economics

**Status:** Accepted
**Author:** Danny Saenz
**Context:** Originally embedded as a subsection of ADR-001; extracted to standalone file Feb 2026.

---

## Context

Deep economic analysis of Sui gas costs revealed that per-claim gas (~$0.005) makes
sub-minute streaming claims unprofitable at low accrual rates ($0.0003/sec baseline
inference pricing). The break-even claim interval is ~17 seconds; the efficient operating
point is 5+ minute claims (5.6% gas overhead).

---

## Decisions

### 1. `buildBatchClaimTx` — SDK-level batch claiming

Claims from N streams in a single PTB. Reduces per-stream gas by 60–70% by amortizing the
base transaction cost across multiple `moveCall` operations.

**Constraints (derived from Sui PTB limits and Move type system):**
- Max 512 streams per batch — Sui PTB command limit (`packages/sui/src/ptb/stream.ts:232`)
- All streams in a batch must share the same coin type — Move type arguments are
  statically fixed per PTB (`packages/sui/src/ptb/types.ts:139`)

**Consequence:** Batching is the recipient's responsibility, not the facilitator's.
The facilitator settles individual payments; it has no visibility into which pending claims
a recipient should group together.

---

### 2. SDK minimum claim threshold guidance

The SDK should recommend minimum claim thresholds. Do not claim until accrued value exceeds
a configurable minimum (default: 20× gas cost).

**Economic table:**

| Claim Interval | Accrued at $0.0003/sec | Gas overhead |
|---|---|---|
| 1 second | $0.0003 | **1,667% (loss)** |
| 5 minutes | $0.09 | **5.6% (competitive)** |
| 30 minutes | $0.54 | **0.9% (excellent)** |

At $0.001/sec (GPT-4 class inference), even 2-minute claims keep gas under 5%.

**Key insight:** The streaming meter accrues per-millisecond on-chain (the math is precise),
but settlement is a periodic batch operation. This is the correct architecture — like a water
meter that ticks every drop but is read monthly.

---

### 3. Gas sponsorship — infrastructure in place, not yet activated

Facilitators can sponsor recipient claim gas via Sui's `GasData` dual-signature mechanism,
making gas an operational cost for the facilitator rather than a burden on the recipient.

**What is already wired:**
- `FACILITATOR_KEYPAIR` env var in `packages/facilitator/src/config.ts` (optional field)
- `FacilitatorSuiSigner.executeTransaction(tx, signature | string[])` accepts an array of
  signatures to support sponsored transactions (`packages/sui/src/signer.ts:67`)
- `getAddresses()` on the signer returns all facilitator-controlled addresses for use as
  gas sponsor

**What is not yet wired:** The `FACILITATOR_KEYPAIR` is not decoded or used in any current
scheme handler. Gas sponsorship is Phase 2.

**Why defer:** Volume must justify the operational cost. Sponsoring gas for low-volume
Phase 1 would subsidize test traffic. Ship the architecture, activate when warranted.

---

### 4. Fee precision — 1,000,000 denominator (micro-percent)

The on-chain fee calculation uses `1_000_000` as the denominator rather than the
traditional `10_000` (basis points). See `contracts/sources/math.move`.

**Why:** At AI agent micropayment scale, infrastructure fees may be sub-bps (< 0.01%).
A 10,000 denominator forces a 1 bps minimum. Changing the denominator post-launch is a
breaking upgrade; at pre-launch it is free. The 1,000,000 denominator enables fees as small
as 0.0001% without a future protocol upgrade.

**Overflow safety:** All fee math uses `u128` intermediate arithmetic to prevent overflow
on large amounts — the same class of vulnerability that caused the Cetus DEX $223M exploit.

**Note:** The facilitator's off-chain fee calculation (`packages/facilitator/src/metering/fee-calculator.ts`)
uses the traditional `10_000` basis point denominator. This is a separate layer — the
facilitator's service fee is independent of the protocol fee. Both can coexist.

---

## Rejected Alternatives

| Alternative | Reason rejected |
|---|---|
| Per-second on-chain settlement | Economically broken at $0.0003/sec; 1,667% gas overhead |
| Facilitator-side batching | Facilitator has no visibility into which claims to group; recipient is the right actor |
| 10,000 denominator for protocol fees | Prevents sub-bps fees needed for infrastructure micro-charges; free to future-proof now |
| Activate gas sponsorship immediately | Premature; subsidizes test traffic; Phase 2 |

---

## References

- `packages/sui/src/ptb/stream.ts` — `buildBatchClaimTx` (line 217)
- `packages/sui/src/ptb/types.ts` — `BatchClaimParams` (line 133)
- `packages/sui/test/unit/ptb.test.ts` — batch claim tests (lines 317–350, 545–560)
- `contracts/sources/stream.move` — `claim` with fee splitting (lines 282, 328–348)
- `contracts/sources/math.move` — `calculate_fee` with u128 intermediate (lines 1–76)
- `packages/facilitator/src/config.ts` — `FACILITATOR_KEYPAIR` (line 14)
- `packages/sui/src/signer.ts` — dual-signature interface (lines 29, 67)
- `docs/adr/001-composable-ptb-pattern.md` — original embedded source (lines 130–157)
- `SPEC.md` lines 137–139 — economic analysis
