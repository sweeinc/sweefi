#[test_only]
module sweepay::agent_mandate_tests {
    use sweepay::agent_mandate;
    use sweepay::mandate;
    use sui::test_scenario as ts;
    use sui::clock;
    use sui::sui::SUI;

    const DELEGATOR: address = @0xD;
    const DELEGATE: address = @0xA;

    // ══════════════════════════════════════════════════════════════
    // Create + spend happy path (L2 capped)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_l2_and_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE,
            2,                   // L2: capped purchasing
            1_000_000_000,       // max_per_tx: 1 SUI
            5_000_000_000,       // daily_limit: 5 SUI
            20_000_000_000,      // weekly_limit: 20 SUI
            100_000_000_000,     // max_total: 100 SUI
            1_000_000,           // expires_at_ms: 1000s
            &clock,
            ctx,
        );

        // Verify initial state
        assert!(agent_mandate::delegator(&m) == DELEGATOR);
        assert!(agent_mandate::delegate(&m) == DELEGATE);
        assert!(agent_mandate::level(&m) == 2);
        assert!(agent_mandate::total_spent(&m) == 0);
        assert!(agent_mandate::daily_spent(&m) == 0);
        assert!(agent_mandate::weekly_spent(&m) == 0);
        assert!(agent_mandate::remaining(&m) == 100_000_000_000);

        // Switch to delegate for spending
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 500M MIST
        agent_mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 500_000_000);
        assert!(agent_mandate::daily_spent(&m) == 500_000_000);
        assert!(agent_mandate::weekly_spent(&m) == 500_000_000);

        // Spend another 300M MIST
        agent_mandate::validate_and_spend(&mut m, 300_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 800_000_000);
        assert!(agent_mandate::daily_remaining(&m) == 4_200_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // L3 autonomous mandate works
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_l3_autonomous_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 3, // L3
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // L3 can spend too
        agent_mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 500_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // L0/L1 cannot spend
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::ELevelNotAuthorized)]
    fun test_l0_cannot_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 0, // L0: read-only
            0, 0, 0, 0, 1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — L0 can't spend
        agent_mandate::validate_and_spend(&mut m, 1, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ELevelNotAuthorized)]
    fun test_l1_cannot_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 1, // L1: monitor
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — L1 can't spend
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Daily limit enforcement
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EDailyLimitExceeded)]
    fun test_daily_limit_exceeded() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,       // max_per_tx: 5 SUI
            2_000_000_000,       // daily_limit: 2 SUI (low)
            100_000_000_000,     // weekly_limit: 100 SUI
            100_000_000_000,     // max_total: 100 SUI
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 1.5 SUI (ok, under daily 2 SUI)
        agent_mandate::validate_and_spend(&mut m, 1_500_000_000, &registry, &clock, ctx);

        // Spend 1 SUI more (total daily: 2.5 SUI > 2 SUI limit)
        agent_mandate::validate_and_spend(&mut m, 1_000_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Weekly limit enforcement
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EWeeklyLimitExceeded)]
    fun test_weekly_limit_exceeded() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,       // max_per_tx: 5 SUI
            0,                   // daily_limit: 0 (no daily limit)
            3_000_000_000,       // weekly_limit: 3 SUI (low)
            100_000_000_000,
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 2 SUI (ok)
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        // Spend 2 SUI more (total weekly: 4 SUI > 3 SUI limit)
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Lazy daily reset — spend again after 24h
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_daily_reset_after_24h() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,       // max_per_tx: 5 SUI
            2_000_000_000,       // daily_limit: 2 SUI
            100_000_000_000,     // weekly_limit: 100 SUI
            100_000_000_000,     // max_total
            10_000_000_000,      // expires far future (10M seconds)
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 2 SUI (hits daily limit)
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::daily_spent(&m) == 2_000_000_000);
        assert!(agent_mandate::daily_remaining(&m) == 0);

        // Advance clock by 24 hours + 1ms
        clock::set_for_testing(&mut clock, 86_400_001);

        // Now spend again — lazy reset should kick in
        agent_mandate::validate_and_spend(&mut m, 1_000_000_000, &registry, &clock, ctx);
        // daily_spent should be 1 SUI (reset happened, then debited)
        assert!(agent_mandate::daily_spent(&m) == 1_000_000_000);
        // total_spent should be 3 SUI (cumulative, never resets)
        assert!(agent_mandate::total_spent(&m) == 3_000_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Lazy weekly reset — spend again after 7d
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_weekly_reset_after_7d() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,       // max_per_tx
            0,                   // no daily limit
            3_000_000_000,       // weekly_limit: 3 SUI
            100_000_000_000,
            1_000_000_000,       // expires at 1M seconds
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 3 SUI (hits weekly limit)
        agent_mandate::validate_and_spend(&mut m, 3_000_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 3_000_000_000);

        // Advance clock by 7 days + 1ms
        clock::set_for_testing(&mut clock, 604_800_001);

        // Lazy weekly reset kicks in
        agent_mandate::validate_and_spend(&mut m, 1_000_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 1_000_000_000);
        assert!(agent_mandate::total_spent(&m) == 4_000_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Per-tx limit
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EPerTxLimitExceeded)]
    fun test_per_tx_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000,       // max_per_tx: 1 SUI
            5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Try to spend 2 SUI (exceeds per-tx limit)
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Total lifetime limit
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::ETotalLimitExceeded)]
    fun test_total_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,       // max_per_tx: 5 SUI
            0,                   // no daily limit
            0,                   // no weekly limit
            3_000_000_000,       // max_total: 3 SUI (tight)
            10_000_000_000,
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 2 SUI
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        // Advance a day to avoid any daily cap confusion
        clock::set_for_testing(&mut clock, 86_400_001);

        // Spend 2 SUI more (total 4 > max_total 3)
        agent_mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Expiry
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EExpired)]
    fun test_expired_agent_mandate() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            50_000, // expires at 50s
            &clock, ctx,
        );

        clock::set_for_testing(&mut clock, 60_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — expired
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Wrong caller
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegate)]
    fun test_wrong_caller() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Stay as DELEGATOR
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Level upgrade
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_upgrade_l1_to_l2() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 1, // L1: monitor
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        assert!(agent_mandate::level(&m) == 1);
        assert!(!agent_mandate::can_spend(&m, &clock));

        // Delegator upgrades to L2
        agent_mandate::upgrade_level(&mut m, 2, ctx);
        assert!(agent_mandate::level(&m) == 2);
        assert!(agent_mandate::can_spend(&m, &clock));

        // Now delegate can spend
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 500_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ECannotDowngrade)]
    fun test_cannot_downgrade() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2, // L2
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Try to downgrade to L1 — should fail
        agent_mandate::upgrade_level(&mut m, 1, ctx);

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegator)]
    fun test_upgrade_wrong_caller() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 1,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Switch to delegate
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Delegate tries to upgrade themselves — should fail
        agent_mandate::upgrade_level(&mut m, 2, ctx);

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Cap update by delegator
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_update_caps() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Delegator increases daily limit
        agent_mandate::update_caps(&mut m, 2_000_000_000, 10_000_000_000, 40_000_000_000, 200_000_000_000, ctx);

        assert!(agent_mandate::max_per_tx(&m) == 2_000_000_000);
        assert!(agent_mandate::daily_limit(&m) == 10_000_000_000);
        assert!(agent_mandate::weekly_limit(&m) == 40_000_000_000);
        assert!(agent_mandate::max_total(&m) == 200_000_000_000);

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Revocation via shared registry (now mandatory on all spend paths)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::ERevoked)]
    fun test_revoked_agent_mandate() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Create mandate
        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );
        let mandate_id = object::id(&m);

        // Create registry (same module as basic mandate)
        mandate::create_registry(ctx);

        ts::next_tx(&mut scenario, DELEGATOR);
        let mut registry = ts::take_shared<mandate::RevocationRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);

        // Revoke the agent mandate (using mandate::revoke with raw ID)
        mandate::revoke<SUI>(&mut registry, mandate_id, ctx);

        // Switch to delegate
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — revoked (validate_and_spend now always checks registry)
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        ts::return_shared(registry);
        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // View function: is_expired
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_is_expired() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 1,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            50_000, &clock, ctx,
        );

        assert!(!agent_mandate::is_expired(&m, &clock));

        clock::set_for_testing(&mut clock, 50_001);
        assert!(agent_mandate::is_expired(&m, &clock));

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // View function: can_spend
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_can_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // L1 mandate — can't spend
        let m1 = agent_mandate::create<SUI>(
            DELEGATE, 1, 0, 0, 0, 0, 50_000, &clock, ctx,
        );
        assert!(!agent_mandate::can_spend(&m1, &clock));

        // L2 mandate — can spend
        let m2 = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            50_000, &clock, ctx,
        );
        assert!(agent_mandate::can_spend(&m2, &clock));

        // Expire it
        clock::set_for_testing(&mut clock, 50_001);
        assert!(!agent_mandate::can_spend(&m2, &clock));

        agent_mandate::destroy_for_testing(m1);
        agent_mandate::destroy_for_testing(m2);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Invalid level on create
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EInvalidLevel)]
    fun test_invalid_level() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Level 4 doesn't exist
        let m = agent_mandate::create<SUI>(
            DELEGATE, 4,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Zero daily/weekly limits = no periodic cap
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_zero_limits_means_no_periodic_cap() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,   // max_per_tx: 5 SUI
            0,               // daily_limit: 0 (no daily cap)
            0,               // weekly_limit: 0 (no weekly cap)
            50_000_000_000,  // max_total: 50 SUI
            1_000_000, &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 5 SUI five times (25 total) — no daily/weekly cap to stop us
        let mut i = 0;
        while (i < 5) {
            agent_mandate::validate_and_spend(&mut m, 5_000_000_000, &registry, &clock, ctx);
            i = i + 1;
        };
        assert!(agent_mandate::total_spent(&m) == 25_000_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Production destroy function
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_destroy_by_delegate() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Delegate destroys their own mandate
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::destroy(m, ctx);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegate)]
    fun test_destroy_by_non_delegate_fails() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            1_000_000, &clock, ctx,
        );

        // Delegator tries to destroy — should fail (only delegate can)
        agent_mandate::destroy(m, ctx);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
