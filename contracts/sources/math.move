/// SweeFi Math — shared arithmetic utilities
///
/// Extracted from payment.move / stream.move / escrow.move / prepaid.move
/// to prevent copy-paste drift where one copy gets a fix and others don't.
module sweefi::math {
    const EOverflow: u64 = 900;

    /// Calculate fee with overflow protection.
    /// Uses u128 intermediate to prevent overflow on large amounts.
    /// Safe: amount <= u64::MAX, fee_bps <= 10000, so result <= u64::MAX.
    ///
    /// Note: for small amounts, integer division may round to 0.
    /// E.g., 50 bps (0.5%) on 199 = 0. Use calculate_fee_min() if a
    /// minimum floor is needed (e.g., 1 MIST minimum fee).
    public fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        if (fee_bps == 0) return 0;
        let result = ((amount as u128) * (fee_bps as u128)) / 10_000u128;
        assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
        (result as u64)
    }

    /// Calculate fee with a minimum floor.
    /// Returns max(calculated_fee, min_fee) when fee_bps > 0.
    /// Use when the facilitator requires at least `min_fee` base units per tx.
    public fun calculate_fee_min(amount: u64, fee_bps: u64, min_fee: u64): u64 {
        let fee = calculate_fee(amount, fee_bps);
        if (fee_bps > 0 && fee < min_fee) {
            min_fee
        } else {
            fee
        }
    }
}
