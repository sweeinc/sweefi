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
}
