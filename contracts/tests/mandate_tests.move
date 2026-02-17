#[test_only]
module sweepay::mandate_tests {
    use sweepay::mandate;
    use sui::test_scenario as ts;
    use sui::clock;
    use sui::sui::SUI;

    const DELEGATOR: address = @0xD;
    const DELEGATE: address = @0xA;

    // ══════════════════════════════════════════════════════════════
    // Create + spend happy path
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_and_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Delegator creates mandate
        let mut m = mandate::create<SUI>(
            DELEGATE,        // delegate
            1_000_000_000,   // max_per_tx: 1 SUI
            10_000_000_000,  // max_total: 10 SUI
            100_000,         // expires_at_ms: 100s from epoch
            &clock,
            ctx,
        );

        // Verify initial state
        assert!(mandate::delegator(&m) == DELEGATOR);
        assert!(mandate::delegate(&m) == DELEGATE);
        assert!(mandate::total_spent(&m) == 0);
        assert!(mandate::remaining(&m) == 10_000_000_000);

        // Switch to delegate context for spending
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 500M MIST (0.5 SUI)
        mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 500_000_000);
        assert!(mandate::remaining(&m) == 9_500_000_000);

        // Spend another 300M MIST
        mandate::validate_and_spend(&mut m, 300_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 800_000_000);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Per-transaction limit
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_per_tx_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,   // max_per_tx: 1 SUI
            10_000_000_000,
            100_000,
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Try to spend 2 SUI (exceeds per-tx limit of 1 SUI)
        mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Total limit
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_total_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            5_000_000_000,   // max_per_tx: 5 SUI
            2_000_000_000,   // max_total: 2 SUI (lower than per_tx for this test)
            100_000,
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 1.5 SUI (ok)
        mandate::validate_and_spend(&mut m, 1_500_000_000, &registry, &clock, ctx);

        // Spend 1 SUI more (total 2.5 SUI > max_total 2 SUI)
        mandate::validate_and_spend(&mut m, 1_000_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Expiry
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_expired_mandate() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            50_000, // expires at 50s
            &clock,
            ctx,
        );

        // Advance clock past expiry
        clock::set_for_testing(&mut clock, 60_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — mandate expired
        mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Wrong caller (not delegate)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_wrong_caller() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            100_000,
            &clock,
            ctx,
        );

        // Stay as DELEGATOR (not DELEGATE)
        // Should fail — only delegate can spend
        mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // View functions
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_is_expired() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            50_000,
            &clock,
            ctx,
        );

        // Not expired yet
        assert!(!mandate::is_expired(&m, &clock));

        // Advance past expiry
        clock::set_for_testing(&mut clock, 50_001);
        assert!(mandate::is_expired(&m, &clock));

        mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
