# ADR-003: Fee Rounding & Financial Precision

**Status:** Accepted
**Date:** 2026-02-13
**Authors:** Builder AI (Session 109), Strategy AI (Session 108)

## Context

SweeFi charges fees in micro-percent on payments, stream claims, and escrow releases. The on-chain fee calculation `(amount * fee_micro_pct) / 1_000_000` (where 1,000,000 = 100%) produces fractional token amounts when the result doesn't divide evenly. A decision must be made about rounding direction and arithmetic safety — both on-chain (Move) and off-chain (TypeScript).

> **Unit note**: Both the TS SDK and Move contracts use micro-percent natively (0–1,000,000 where 1,000,000 = 100%). This enables sub-bps fee precision for AI agent micropayments. A public `bpsToMicroPercent()` convenience is available for callers who think in traditional basis points, but it's not used internally. See ADR-002 §4 for the rationale.

Financial protocols have three options:
1. **Round up** (ceiling) — protocol collects more, user pays more
2. **Round down** (floor / truncate) — protocol collects less, user pays less
3. **Banker's rounding** — alternates, complex, not available in integer math

Additionally, the TypeScript SDK must convert human-readable amounts (e.g., "1.5" SUI) to on-chain base units (1,500,000,000 MIST) without floating-point precision loss.

## Decision

### On-Chain (Move): Truncate Toward Zero

All fee-bearing modules share `sweefi::math::calculate_fee()`:

```move
const FEE_DENOMINATOR: u128 = 1_000_000; // 1,000,000 = 100% (micro-percent)

public fun calculate_fee(amount: u64, fee_micro_pct: u64): u64 {
    if (fee_micro_pct == 0) return 0;
    let result = ((amount as u128) * (fee_micro_pct as u128)) / FEE_DENOMINATOR;
    assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
    (result as u64)
}
```

Key properties:
- **Micro-percent denominator**: `1,000,000 = 100%`. Enables sub-bps fees for AI agent micropayments (e.g., `10 = 0.001%`). See ADR-002 §4 for why this was chosen over the traditional 10,000 (bps) denominator.
- **u128 intermediate**: Prevents overflow on large amounts. A u64 multiplication would overflow at ~1.8 × 10^15 tokens — well within realistic USDC/SUI ranges. The u128 intermediate handles amounts up to ~3.4 × 10^34. This follows the Cetus pattern after their $223M overflow incident.
- **Integer division truncates**: Move's `/` operator on unsigned integers truncates toward zero. This means `fee = floor(amount * fee_micro_pct / 1_000_000)`.
- **Protocol never overcharges**: The invariant is `fee_amount + recipient_amount <= original_amount`. Truncation guarantees this — any remainder stays with the payer as a rounding bonus.
- **fee_micro_pct validated on input**: `assert!(fee_micro_pct <= 1_000_000, EInvalidFeeMicroPct)` — prevents fees exceeding 100%.
- **Zero-fee fast path**: `if (fee_micro_pct == 0) return 0` skips division entirely.
- **Unified units**: Both TS SDK (`feeMicroPercent`) and Move (`fee_micro_pct`) use micro-percent natively. No conversion needed at the PTB boundary.

### Off-Chain (TypeScript): Pure String Arithmetic

The `convertToTokenAmount()` function in the SDK uses string manipulation instead of `parseFloat()`:

```typescript
export function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  const [intPart, decPart = ""] = trimmed.split(".");
  const paddedDec = decPart.slice(0, decimals).padEnd(decimals, "0");
  const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
  return tokenAmount;
}
```

Key properties:
- **No parseFloat**: Avoids IEEE 754 precision loss. `parseFloat("0.1")` is `0.1000000000000000055511151231257827021181583404541015625` — this matters when multiplied by 10^9.
- **Truncation on sub-atomic amounts**: If the user provides more decimal places than the token supports (e.g., "0.0000001" for 6-decimal USDC), the extra digits are silently dropped. No rounding.
- **BigInt throughout**: Once converted to base units, all arithmetic uses `BigInt` (TypeScript) or `u64`/`u128` (Move). No floating-point anywhere in the money path.

## Consequences

### Positive

- **Invariant holds universally**: `fee + net <= gross`. No edge case where truncation causes the protocol to extract more than deposited.
- **Deterministic**: Same inputs always produce same outputs. No platform-dependent floating-point behavior.
- **Auditor-friendly**: Integer arithmetic with truncation is the simplest model to verify. No rounding tables, no mode flags.
- **User-favorable**: In the rare case where rounding matters (small amounts, odd bps values), the user keeps the extra fraction.

### Negative

- **Fee recipient loses fractions**: On a 5,000 micro-percent fee (= 50 bps = 0.5%) for 999 base units, the fee is `floor(999 * 5_000 / 1_000_000) = floor(4.995) = 4`, not 5. The fee recipient loses 0.005 tokens worth. At scale this is negligible — at $1M volume with 50 bps, the rounding loss is < $0.01.
- **Sub-atomic truncation is silent**: `convertToTokenAmount("0.0000001", 6)` returns `"0"` without warning. This is intentional (no amount below the token's precision can exist on-chain) but could surprise users.

## References

- `contracts/sources/math.move` — `calculate_fee()` with `FEE_DENOMINATOR = 1_000_000` (shared by all modules)
- `packages/sui/src/ptb/assert.ts` — `assertFeeMicroPercent()` validation + `bpsToMicroPercent()` public convenience
- `packages/sui/src/utils.ts` — `convertToTokenAmount()` (pure string arithmetic)
- `docs/adr/002-batch-claims-gas-economics.md` §4 — rationale for 1,000,000 denominator
- [Cetus overflow post-mortem](https://twitter.com/CetusProtocol/status/1795803498547392782) — motivation for u128 intermediate
