#[test_only]
module sweefi::math_tests {
    use sweefi::math;

    // ══════════════════════════════════════════════════════════════
    // calculate_fee (existing function — baseline coverage)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_calculate_fee_normal() {
        // 0.5% (5_000 micro-percent) on 1,000,000 = 5,000
        assert!(math::calculate_fee(1_000_000, 5_000) == 5_000);
    }

    #[test]
    fun test_calculate_fee_zero_bps() {
        // 0% fee on any amount = 0 (free transaction semantic)
        assert!(math::calculate_fee(999_999_999, 0) == 0);
    }

    #[test]
    fun test_calculate_fee_zero_amount() {
        assert!(math::calculate_fee(0, 5_000) == 0);
    }

    #[test]
    fun test_calculate_fee_100_percent() {
        // 100% (1_000_000 micro-percent) = full amount
        assert!(math::calculate_fee(42_000, 1_000_000) == 42_000);
    }

    #[test]
    fun test_calculate_fee_truncates_floor() {
        // 0.5% on 199 = 0.995 → truncates to 0
        // This is the documented edge case that motivates calculate_fee_min()
        assert!(math::calculate_fee(199, 5_000) == 0);
    }

    #[test]
    fun test_calculate_fee_large_amount_no_overflow() {
        // u64::MAX / 2 at 50% — exercises u128 intermediate arithmetic
        let half_max = 0xFFFFFFFFFFFFFFFF / 2;
        let fee = math::calculate_fee(half_max, 500_000);
        assert!(fee == half_max / 2);
    }

    #[test]
    #[expected_failure(abort_code = math::EOverflow)]
    fun test_calculate_fee_overflow_aborts() {
        // fee_micro_pct > 1_000_000 violates precondition — defense-in-depth catches it
        math::calculate_fee(0xFFFFFFFFFFFFFFFF, 1_000_001);
    }

    // ══════════════════════════════════════════════════════════════
    // calculate_fee_min (the function under audit review)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_fee_min_floor_kicks_in() {
        // 0.5% on 199 = 0 (truncated), but min_fee = 1_000
        // Floor should win: max(0, 1_000) = 1_000
        assert!(math::calculate_fee_min(199, 5_000, 1_000) == 1_000);
    }

    #[test]
    fun test_fee_min_percentage_wins() {
        // 0.5% on 1,000,000 = 5,000, min_fee = 1_000
        // Percentage wins: max(5_000, 1_000) = 5_000
        assert!(math::calculate_fee_min(1_000_000, 5_000, 1_000) == 5_000);
    }

    #[test]
    fun test_fee_min_zero_bps_ignores_floor() {
        // fee_micro_pct = 0 means "free transaction" — min_fee must NOT apply
        // This is the critical guard: free stays free even with a floor set
        assert!(math::calculate_fee_min(1_000_000, 0, 1_000) == 0);
    }

    #[test]
    fun test_fee_min_zero_amount() {
        // 0 amount at any rate with any floor = 0
        // (fee_micro_pct > 0 but calculated fee = 0, floor kicks in)
        assert!(math::calculate_fee_min(0, 5_000, 1_000) == 1_000);
    }

    #[test]
    fun test_fee_min_exact_boundary() {
        // When percentage fee exactly equals the floor, percentage wins (no change)
        // 1% on 100_000 = 1_000, min_fee = 1_000
        assert!(math::calculate_fee_min(100_000, 10_000, 1_000) == 1_000);
    }

    // ══════════════════════════════════════════════════════════════
    // Audit coverage: edge cases identified in v0.4 Move audit
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_calculate_fee_u64_max() {
        // 100% fee on u64::MAX should return u64::MAX
        assert!(math::calculate_fee(0xFFFFFFFFFFFFFFFF, 1_000_000) == 0xFFFFFFFFFFFFFFFF);
    }

    #[test]
    fun test_calculate_fee_amount_1_with_fee() {
        // Minimum non-zero amount with fee: 0.5% on 1 = 0 (truncated)
        assert!(math::calculate_fee(1, 5_000) == 0);
    }

    #[test]
    fun test_calculate_fee_amount_1_at_100_percent() {
        // 100% fee on 1 = 1
        assert!(math::calculate_fee(1, 1_000_000) == 1);
    }

    #[test]
    fun test_fee_min_exceeds_amount() {
        // AUDIT FINDING 1: calculate_fee_min can return fee > amount.
        // This documents the current behavior. min_fee=1000 on amount=500
        // returns 1000 (the floor), which is 2x the payment amount.
        // No current caller uses calculate_fee_min, so this is a latent footgun.
        assert!(math::calculate_fee_min(500, 1, 1_000) == 1_000);
        // fee (1000) > amount (500) — callers must validate this themselves
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: math::calculate_fee()
    // ══════════════════════════════════════════════════════════════
    //
    // Internal logic:
    //   C1: fee_micro_pct == 0 → return 0 (early exit, "free tx" semantic)
    //   C2: result <= u64::MAX  (assert!, EOverflow — defense-in-depth)
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬──────────┐
    // │ Test │ C1 │ C2 │ Result   │
    // ├──────┼────┼────┼──────────┤
    // │ HP   │ F  │ T  │ fee      │ (normal computation)
    // │ MC-1 │ T  │ *  │ 0        │ (early return, C2 never reached)
    // │ MC-2 │ F  │ F  │ EOverflow│ (requires fee_micro_pct > 1M)
    // └──────┴────┴────┴──────────┘
    //
    // Existing coverage:
    //   HP → test_calculate_fee_normal
    //   MC-1 → test_calculate_fee_zero_bps
    //   MC-2 → test_calculate_fee_overflow_aborts
    //
    // BVA boundaries:
    //   fee_micro_pct: 0 (early return), 1 (smallest fee), 1_000_000 (100%), 1_000_001 (overflow trigger)
    //   amount: 0 (→fee=0), 1, u64::MAX
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: normal fee calculation
    #[test]
    fun test_mcdc_hp_calculate_fee() {
        // 1% on 1_000_000 = 10_000
        assert!(math::calculate_fee(1_000_000, 10_000) == 10_000);
    }

    /// MC/DC MC-1: fee_micro_pct=0 → always 0 (free tx)
    #[test]
    fun test_mcdc_mc1_calculate_fee_zero_pct() {
        assert!(math::calculate_fee(1_000_000, 0) == 0);
        assert!(math::calculate_fee(0xFFFFFFFFFFFFFFFF, 0) == 0);
    }

    /// MC/DC MC-2: overflow (fee_micro_pct > 1M on large amount) → EOverflow
    #[test]
    #[expected_failure(abort_code = math::EOverflow)]
    fun test_mcdc_mc2_calculate_fee_overflow() {
        math::calculate_fee(0xFFFFFFFFFFFFFFFF, 1_000_001);
    }

    /// BVA: fee_micro_pct=1 (smallest non-zero fee) on large amount
    #[test]
    fun test_mcdc_bva_calculate_fee_min_pct() {
        // 0.0001% on 1_000_000 = 1
        assert!(math::calculate_fee(1_000_000, 1) == 1);
    }

    /// BVA: fee_micro_pct=1 on small amount → truncates to 0
    #[test]
    fun test_mcdc_bva_calculate_fee_min_pct_truncates() {
        // 0.0001% on 999_999 = 0.999999 → 0
        assert!(math::calculate_fee(999_999, 1) == 0);
    }

    /// BVA: fee at exact max (1_000_000) on u64::MAX → returns u64::MAX
    #[test]
    fun test_mcdc_bva_calculate_fee_max_pct_max_amount() {
        assert!(math::calculate_fee(0xFFFFFFFFFFFFFFFF, 1_000_000) == 0xFFFFFFFFFFFFFFFF);
    }

    /// BVA: fee at max-1 (999_999) on u64::MAX → just under u64::MAX
    #[test]
    fun test_mcdc_bva_calculate_fee_almost_max_pct() {
        let result = math::calculate_fee(0xFFFFFFFFFFFFFFFF, 999_999);
        // result = u64::MAX * 999_999 / 1_000_000 — should be strictly less than u64::MAX
        // Exact: (18446744073709551615 * 999999) / 1000000 = 18446744073691104871
        assert!(result < 0xFFFFFFFFFFFFFFFF);
        // Verify it's non-zero and meaningful
        assert!(result > 0);
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: math::calculate_fee_min()
    // ══════════════════════════════════════════════════════════════
    //
    // Internal logic:
    //   Calls calculate_fee(amount, fee_micro_pct) → fee
    //   C1: fee_micro_pct > 0      (guard for min_fee application)
    //   C2: fee < min_fee          (when to apply floor)
    //
    // Decision: if (fee_micro_pct > 0 && fee < min_fee) return min_fee else return fee
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬──────────┐
    // │ Test │ C1 │ C2 │ Result   │
    // ├──────┼────┼────┼──────────┤
    // │ HP   │ T  │ F  │ fee      │ (calculated fee >= min_fee)
    // │ T-1  │ T  │ T  │ min_fee  │ (floor kicks in)
    // │ MC-1 │ F  │ *  │ 0        │ (free tx — floor ignored)
    // └──────┴────┴────┴──────────┘
    //
    // Existing coverage:
    //   HP → test_fee_min_percentage_wins
    //   T-1 → test_fee_min_floor_kicks_in
    //   MC-1 → test_fee_min_zero_bps_ignores_floor
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: fee >= min_fee → calculated fee wins
    #[test]
    fun test_mcdc_hp_calculate_fee_min() {
        // 1% on 1_000_000 = 10_000, min_fee = 5_000
        // fee (10_000) >= min_fee (5_000) → return 10_000
        assert!(math::calculate_fee_min(1_000_000, 10_000, 5_000) == 10_000);
    }

    /// MC/DC T-1: fee < min_fee → floor kicks in
    #[test]
    fun test_mcdc_t1_calculate_fee_min_floor() {
        // 0.5% on 100 = 0 (truncated), min_fee = 1_000
        // fee (0) < min_fee (1_000) → return 1_000
        assert!(math::calculate_fee_min(100, 5_000, 1_000) == 1_000);
    }

    /// MC/DC MC-1: fee_micro_pct=0 → free tx, ignore min_fee
    #[test]
    fun test_mcdc_mc1_calculate_fee_min_zero_pct() {
        // C1=false → free transaction, even with min_fee=1_000_000
        assert!(math::calculate_fee_min(1_000_000, 0, 1_000_000) == 0);
    }

    /// BVA: fee exactly equals min_fee → fee wins (no change)
    #[test]
    fun test_mcdc_bva_calculate_fee_min_exact_boundary() {
        // 1% on 100_000 = 1_000, min_fee = 1_000
        // fee == min_fee → C2=false → return fee
        assert!(math::calculate_fee_min(100_000, 10_000, 1_000) == 1_000);
    }

    /// BVA: fee = min_fee - 1 → floor kicks in
    #[test]
    fun test_mcdc_bva_calculate_fee_min_one_below() {
        // 1% on 99_900 = 999, min_fee = 1_000
        // fee (999) < min_fee (1_000) → return 1_000
        assert!(math::calculate_fee_min(99_900, 10_000, 1_000) == 1_000);
    }

    /// BVA: fee = min_fee + 1 → fee wins
    #[test]
    fun test_mcdc_bva_calculate_fee_min_one_above() {
        // 1% on 100_100 = 1_001, min_fee = 1_000
        // fee (1_001) > min_fee (1_000) → return 1_001
        assert!(math::calculate_fee_min(100_100, 10_000, 1_000) == 1_001);
    }
}
