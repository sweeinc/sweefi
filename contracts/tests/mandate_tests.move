#[test_only]
module sweefi::mandate_tests {
    use sweefi::mandate;
    use sui::test_scenario as ts;
    use sui::clock;
    use sui::sui::SUI;

    const DELEGATOR: address = @0xD;
    const DELEGATE: address = @0xA;
    const THIRD_PARTY: address = @0xC; // non-delegate holder (zombie mandate tests)

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

    // ══════════════════════════════════════════════════════════════
    // Zombie mandate prevention (T-5) — L-4 fix: destroy_held
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = mandate::ENotDelegate)]
    fun test_destroy_zombie_mandate_by_non_delegate_fails() {
        // T-5a: Mandate accidentally transferred to a non-delegate address becomes a zombie.
        // destroy() checks ctx.sender() == mandate.delegate, so THIRD_PARTY can't clean it up.
        // Without destroy_held(), the mandate is permanently undestroyable — SUI locked in storage.
        //
        // This test confirms the EXISTING guard (destroy is delegate-only) remains intact.
        // T-5b (below) confirms the FIX (destroy_held) allows cleanup by any holder.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = mandate::create<SUI>(DELEGATE, 1_000_000_000, 10_000_000_000, 100_000, &clock, ctx);

        // Transfer to THIRD_PARTY (non-delegate) — simulates erroneous transfer
        // (e.g., a higher-level protocol accidentally forwarded the wrong mandate)
        transfer::public_transfer(m, THIRD_PARTY);

        // THIRD_PARTY holds the mandate but is NOT the delegate
        ts::next_tx(&mut scenario, THIRD_PARTY);
        let m = scenario.take_from_sender<mandate::Mandate<SUI>>();
        let ctx = ts::ctx(&mut scenario);

        // destroy() checks sender == mandate.delegate → THIRD_PARTY != DELEGATE → ENotDelegate
        mandate::destroy(m, ctx);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_destroy_held_cleans_zombie_mandate() {
        // T-5b: destroy_held() enables any current holder to clean up a zombie mandate (L-4 fix).
        // Unlike destroy(), there's no auth check — Mandate holds NO funds (only metadata),
        // so destroying it cannot steal or unlock any value. Cleanup is safe for any holder.
        //
        // This prevents SUI storage bloat from mandates stuck in non-delegate addresses.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = mandate::create<SUI>(DELEGATE, 1_000_000_000, 10_000_000_000, 100_000, &clock, ctx);

        // Transfer to THIRD_PARTY (non-delegate)
        transfer::public_transfer(m, THIRD_PARTY);

        // THIRD_PARTY uses destroy_held() — no auth check, zombie cleaned up successfully
        ts::next_tx(&mut scenario, THIRD_PARTY);
        let m = scenario.take_from_sender<mandate::Mandate<SUI>>();
        mandate::destroy_held(m); // any holder can clean up — safe because no funds held

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
