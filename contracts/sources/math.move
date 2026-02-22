/// SweeFi Math — shared arithmetic utilities
///
/// Extracted from payment.move / stream.move / escrow.move / prepaid.move
/// to prevent copy-paste drift where one copy gets a fix and others don't.
///
/// Trust model: pure library — no objects, no auth, no state.
/// Invariant enforcement (fee_bps <= 1_000_000) is the caller's responsibility;
/// the overflow assert below is defense-in-depth, not the primary guard.
module sweefi::math {
    // Should be unreachable in practice — fires only if a caller forgot to
    // validate fee_bps <= 1_000_000 before calling. The confusing error code
    // is why callers must validate first rather than relying on this.
    const EOverflow: u64 = 900;

    /// Fee denominator: 1,000,000 = 100%.
    ///
    /// Unit: "micro-percent". Common values:
    ///   1_000_000 = 100%     (max allowed by callers)
    ///     500_000 = 50%
    ///      10_000 = 1%       (= 100 basis points in traditional finance)
    ///       5_000 = 0.5%     (= 50 bps)
    ///       1_000 = 0.1%     (= 10 bps)
    ///         100 = 0.01%    (= 1 bps — traditional minimum)
    ///          10 = 0.001%   (= 0.1 bps — sub-bps, enabled by this precision)
    ///           1 = 0.0001%  (= 0.01 bps — finest granularity)
    ///
    /// Why 1,000,000 instead of the traditional 10,000?
    /// At AI agent micropayment scale, infrastructure fees may be sub-bps (< 0.01%).
    /// Changing the denominator post-launch is a breaking upgrade; pre-launch it's free.
    /// The computational cost is identical — one multiply, one divide.
    const FEE_DENOMINATOR: u128 = 1_000_000;

    /// Calculate fee in micro-percent units.
    ///
    /// `fee_bps`: fee rate where 1_000_000 = 100%. See FEE_DENOMINATOR for common values.
    ///
    /// PRECONDITION: callers MUST validate `fee_bps <= 1_000_000` before calling.
    /// If they skip this, the overflow assert below fires with `EOverflow` — a
    /// confusing error for what is really a business rule violation. The assert is
    /// kept as defense-in-depth (if a future caller forgets validation, this module
    /// still won't produce silent bad math), but it cannot fire given valid inputs:
    ///   result = amount * fee_bps / 1_000_000 ≤ amount (since fee_bps ≤ 1_000_000)
    ///   and amount fits in u64, so result fits in u64.
    ///
    /// Uses u128 intermediate arithmetic to prevent overflow (Cetus $223M lesson:
    /// u64 × u64 can exceed u64::MAX before division, silently wrapping to wrong result).
    ///
    /// Note: integer division truncates (floor). At tiny amounts, fee rounds to 0.
    /// E.g., 5_000 (0.5%) on 199 base units = 0. Use calculate_fee_min() for a floor.
    public fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        // Not just an optimization: fee_bps == 0 must ALWAYS return 0 regardless
        // of amount, preserving the "free transaction" semantic contract for callers.
        if (fee_bps == 0) return 0;
        let result = ((amount as u128) * (fee_bps as u128)) / FEE_DENOMINATOR;
        // Defense-in-depth: technically redundant given fee_bps <= 1_000_000 precondition,
        // but makes overflow safety locally verifiable without tracing all callers.
        assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
        (result as u64)
    }

    /// Calculate fee with a minimum floor.
    ///
    /// Returns max(calculated_fee, min_fee) when fee_bps > 0.
    /// Use when the facilitator requires at least `min_fee` base units per tx.
    ///
    /// The `fee_bps > 0` guard is intentional: a zero fee_bps means "free transaction"
    /// — we must not apply a minimum floor to a deliberately free payment.
    public fun calculate_fee_min(amount: u64, fee_bps: u64, min_fee: u64): u64 {
        let fee = calculate_fee(amount, fee_bps);
        if (fee_bps > 0 && fee < min_fee) {
            min_fee
        } else {
            fee
        }
    }
}
