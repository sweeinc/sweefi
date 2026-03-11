#[test_only]
module sweefi::agent_mandate_tests {
    use sweefi::agent_mandate;
    use sweefi::mandate;
    use sui::test_scenario as ts;
    use sui::clock;
    use sui::sui::SUI;

    const DELEGATOR: address = @0xD;
    const DELEGATE: address = @0xA;
    /// u64::MAX sentinel for "effectively unlimited" caps.
    /// Post-audit semantic fix: 0 = zero budget (matches mandate.move), u64::MAX = unlimited.
    const NO_LIMIT: u64 = 18_446_744_073_709_551_615;

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
            option::some(1_000_000), // expires_at_ms: 1000s
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
            option::some(1_000_000), &clock, ctx,
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
            0, 0, 0, 0, option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            NO_LIMIT,            // daily_limit: unlimited
            3_000_000_000,       // weekly_limit: 3 SUI (low)
            100_000_000_000,
            option::some(1_000_000), &clock, ctx,
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
            option::some(10_000_000_000), // expires far future (10M seconds)
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
            NO_LIMIT,            // no daily limit
            3_000_000_000,       // weekly_limit: 3 SUI
            100_000_000_000,
            option::some(1_000_000_000), // expires at 1M seconds
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
            option::some(1_000_000), &clock, ctx,
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
            NO_LIMIT,            // no daily limit
            NO_LIMIT,            // no weekly limit
            3_000_000_000,       // max_total: 3 SUI (tight)
            option::some(10_000_000_000),
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
            option::some(50_000), // expires at 50s
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(50_000), &clock, ctx,
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
            DELEGATE, 1, 0, 0, 0, 0, option::some(50_000), &clock, ctx,
        );
        assert!(!agent_mandate::can_spend(&m1, &clock));

        // L2 mandate — can spend
        let m2 = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::some(50_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
        );

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // u64::MAX daily/weekly limits = effectively no periodic cap
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_max_limits_means_no_periodic_cap() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000,   // max_per_tx: 5 SUI
            NO_LIMIT,        // daily_limit: unlimited
            NO_LIMIT,        // weekly_limit: unlimited
            50_000_000_000,  // max_total: 50 SUI
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
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
            option::some(1_000_000), &clock, ctx,
        );

        // Delegator tries to destroy — should fail (only delegate can)
        agent_mandate::destroy(m, ctx);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Zombie mandate prevention — destroy_held
    // ══════════════════════════════════════════════════════════════

    const THIRD_PARTY: address = @0xC;

    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegate)]
    fun test_destroy_zombie_agent_mandate_by_non_delegate_fails() {
        // AgentMandate accidentally transferred to a non-delegate address becomes
        // a zombie. destroy() checks sender == delegate, so THIRD_PARTY can't
        // clean it up. This confirms the guard remains intact.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Transfer to THIRD_PARTY (non-delegate) — simulates erroneous transfer
        transfer::public_transfer(m, THIRD_PARTY);

        ts::next_tx(&mut scenario, THIRD_PARTY);
        let m = scenario.take_from_sender<agent_mandate::AgentMandate<SUI>>();
        let ctx = ts::ctx(&mut scenario);

        // destroy() checks sender == delegate → THIRD_PARTY != DELEGATE → ENotDelegate
        agent_mandate::destroy(m, ctx);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_destroy_held_cleans_zombie_agent_mandate() {
        // destroy_held() enables any current holder to clean up a zombie AgentMandate.
        // No auth check — AgentMandate holds NO funds (only metadata), so destroying
        // it cannot steal or unlock any value. Cleanup is safe for any holder.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Transfer to THIRD_PARTY (non-delegate)
        transfer::public_transfer(m, THIRD_PARTY);

        // THIRD_PARTY uses destroy_held() — no auth check, zombie cleaned up
        ts::next_tx(&mut scenario, THIRD_PARTY);
        let m = scenario.take_from_sender<agent_mandate::AgentMandate<SUI>>();
        agent_mandate::destroy_held(m);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // No-expiry agent mandate tests (Option<u64> = None)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_and_spend_no_expiry() {
        // None-expiry agent mandate works past any timestamp — spending limited
        // only by per-tx, daily, weekly, total caps and revocation, never by clock.
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000,       // max_per_tx: 1 SUI
            5_000_000_000,       // daily_limit: 5 SUI
            20_000_000_000,      // weekly_limit: 20 SUI
            100_000_000_000,     // max_total: 100 SUI
            option::none(),      // no expiry
            &clock,
            ctx,
        );

        // Advance clock to year 3000 (≈ 32.5 trillion ms)
        clock::set_for_testing(&mut clock, 32_503_680_000_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should succeed — no expiry means clock is irrelevant
        agent_mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 500_000_000);
        assert!(agent_mandate::daily_spent(&m) == 500_000_000);
        assert!(agent_mandate::remaining(&m) == 99_500_000_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_no_expiry_agent_mandate_is_not_expired() {
        // is_expired() returns false for None agent mandate regardless of clock value.
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::none(),
            &clock,
            ctx,
        );

        // Not expired at creation
        assert!(!agent_mandate::is_expired(&m, &clock));

        // Not expired at year 3000
        clock::set_for_testing(&mut clock, 32_503_680_000_000);
        assert!(!agent_mandate::is_expired(&m, &clock));

        // can_spend still returns true (L2 + not expired)
        assert!(agent_mandate::can_spend(&m, &clock));

        // Verify accessor returns None
        assert!(agent_mandate::expires_at_ms(&m).is_none());

        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Audit coverage: F-06 update_caps guards + wrong registry
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = agent_mandate::EDailyLimitExceeded)]
    fun test_update_caps_daily_below_spent_fails() {
        // F-06: Cannot set daily_limit below what's already spent in current period.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Delegate spends 3 SUI
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::validate_and_spend(&mut m, 3_000_000_000, &registry, &clock, ctx);

        // Delegator tries to set daily limit to 2 SUI (below 3 SUI already spent)
        ts::next_tx(&mut scenario, DELEGATOR);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::update_caps(&mut m, 5_000_000_000, 2_000_000_000, 20_000_000_000, 100_000_000_000, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::EWeeklyLimitExceeded)]
    fun test_update_caps_weekly_below_spent_fails() {
        // F-06: Cannot set weekly_limit below what's already spent.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000, NO_LIMIT, 20_000_000_000, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Delegate spends 10 SUI
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::validate_and_spend(&mut m, 5_000_000_000, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 5_000_000_000, &registry, &clock, ctx);

        // Delegator tries to set weekly limit to 8 SUI (below 10 already spent)
        ts::next_tx(&mut scenario, DELEGATOR);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::update_caps(&mut m, 5_000_000_000, NO_LIMIT, 8_000_000_000, 100_000_000_000, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ETotalLimitExceeded)]
    fun test_update_caps_total_below_spent_fails() {
        // F-06: Cannot set max_total below cumulative total_spent.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000, NO_LIMIT, NO_LIMIT, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Delegate spends 50 SUI total
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        let mut i = 0;
        while (i < 10) {
            agent_mandate::validate_and_spend(&mut m, 5_000_000_000, &registry, &clock, ctx);
            i = i + 1;
        };

        // Delegator tries to set max_total to 40 SUI (below 50 already spent)
        ts::next_tx(&mut scenario, DELEGATOR);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::update_caps(&mut m, 5_000_000_000, NO_LIMIT, NO_LIMIT, 40_000_000_000, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegator)]
    fun test_wrong_registry_owner_rejected() {
        // H-1 equivalent: validate_and_spend checks registry_owner == delegator.
        // A rogue delegate passing their own empty registry must be rejected.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            5_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::some(1_000_000), &clock, ctx,
        );

        // Delegate creates their OWN registry (different owner than delegator)
        ts::next_tx(&mut scenario, DELEGATE);
        let rogue_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Spend using rogue registry — should fail with ENotDelegator
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &rogue_registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(rogue_registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ERevoked)]
    fun test_no_expiry_agent_mandate_revocation_still_works() {
        // Revocation kills a None-expiry agent mandate. The kill switch
        // is orthogonal to expiry — the delegator always has an active exit.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000_000_000, 5_000_000_000, 20_000_000_000, 100_000_000_000,
            option::none(),
            &clock,
            ctx,
        );
        let mandate_id = object::id(&m);

        // Create and take registry
        mandate::create_registry(ctx);

        ts::next_tx(&mut scenario, DELEGATOR);
        let mut registry = ts::take_shared<mandate::RevocationRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);

        // Delegator revokes
        mandate::revoke<SUI>(&mut registry, mandate_id, ctx);

        // Delegate tries to spend — should fail with ERevoked
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        agent_mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        ts::return_shared(registry);
        agent_mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════════
    // MC/DC — Modified Condition/Decision Coverage (DO-178B)
    // ══════════════════════════════════════════════════════════════════
    //
    // validate_and_spend Decision: ALLOW iff C1∧C2∧C3∧C4∧C5∧C6∧C7∧C8∧C9
    //
    // C1: registry.owner == mandate.delegator   (ENotDelegator)
    // C2: !is_id_revoked(registry, mandate_id)  (ERevoked)
    // C3: sender == mandate.delegate            (ENotDelegate)
    // C4: !expired                              (EExpired)
    // C5: level >= L2_CAPPED                    (ELevelNotAuthorized)
    // C6: amount <= max_per_tx                  (EPerTxLimitExceeded)
    // C7: daily_spent + amount <= daily_limit   (EDailyLimitExceeded)
    // C8: weekly_spent + amount <= weekly_limit  (EWeeklyLimitExceeded)
    // C9: total_spent + amount <= max_total     (ETotalLimitExceeded)
    //
    // MC/DC Matrix (10 tests for 9 conditions):
    // Test  | C1 C2 C3 C4 C5 C6 C7 C8 C9 | Outcome | Existing Test
    // HP    | T  T  T  T  T  T  T  T  T  | ALLOW   | test_create_l2_and_spend
    // MC-1  | F  T  T  T  T  T  T  T  T  | REJECT  | test_wrong_registry_owner_rejected
    // MC-2  | T  F  T  T  T  T  T  T  T  | REJECT  | test_revoked_agent_mandate
    // MC-3  | T  T  F  T  T  T  T  T  T  | REJECT  | test_wrong_caller
    // MC-4  | T  T  T  F  T  T  T  T  T  | REJECT  | test_expired_agent_mandate
    // MC-5  | T  T  T  T  F  T  T  T  T  | REJECT  | test_l1_cannot_spend
    // MC-6  | T  T  T  T  T  F  T  T  T  | REJECT  | test_per_tx_limit
    // MC-7  | T  T  T  T  T  T  F  T  T  | REJECT  | test_daily_limit_exceeded
    // MC-8  | T  T  T  T  T  T  T  F  T  | REJECT  | test_weekly_limit_exceeded
    // MC-9  | T  T  T  T  T  T  T  T  F  | REJECT  | test_total_limit
    //
    // Status: ALL 10 MC/DC tests satisfied by existing suite.
    //
    // Below: Boundary Value Analysis (BVA) — catches off-by-one errors that
    // MC/DC doesn't. For each numeric cap: test at exact limit (pass) and
    // exact limit + 1 (fail). Critical for financial code.
    // ══════════════════════════════════════════════════════════════════

    // --- BVA: Per-tx limit boundary ---

    #[test]
    fun test_mcdc_bva_per_tx_at_exact_limit() {
        // amount == max_per_tx exactly → should SUCCEED
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000,       // max_per_tx: exactly 1000
            NO_LIMIT, NO_LIMIT, NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly 1000 — at the boundary
        agent_mandate::validate_and_spend(&mut m, 1_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 1_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::EPerTxLimitExceeded)]
    fun test_mcdc_bva_per_tx_one_over() {
        // amount == max_per_tx + 1 → should FAIL
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            1_000,       // max_per_tx: exactly 1000
            NO_LIMIT, NO_LIMIT, NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 1001 — one over the boundary
        agent_mandate::validate_and_spend(&mut m, 1_001, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // --- BVA: Daily limit boundary ---

    #[test]
    fun test_mcdc_bva_daily_at_exact_limit() {
        // daily_spent + amount == daily_limit exactly → should SUCCEED
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT,    // no per-tx cap
            2_000,       // daily_limit: exactly 2000
            NO_LIMIT, NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 1500, then 500 (total daily: 2000 == limit)
        agent_mandate::validate_and_spend(&mut m, 1_500, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 500, &registry, &clock, ctx);
        assert!(agent_mandate::daily_spent(&m) == 2_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::EDailyLimitExceeded)]
    fun test_mcdc_bva_daily_one_over() {
        // daily_spent + amount == daily_limit + 1 → should FAIL
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT,
            2_000,       // daily_limit: exactly 2000
            NO_LIMIT, NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 1500, then 501 (total daily: 2001 > 2000)
        agent_mandate::validate_and_spend(&mut m, 1_500, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 501, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // --- BVA: Weekly limit boundary ---

    #[test]
    fun test_mcdc_bva_weekly_at_exact_limit() {
        // weekly_spent + amount == weekly_limit exactly → should SUCCEED
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT,
            5_000,       // weekly_limit: exactly 5000
            NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 3000, then 2000 (total weekly: 5000 == limit)
        agent_mandate::validate_and_spend(&mut m, 3_000, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 2_000, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 5_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::EWeeklyLimitExceeded)]
    fun test_mcdc_bva_weekly_one_over() {
        // weekly_spent + amount == weekly_limit + 1 → should FAIL
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT,
            5_000,       // weekly_limit: exactly 5000
            NO_LIMIT,
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 3000, then 2001 (total weekly: 5001 > 5000)
        agent_mandate::validate_and_spend(&mut m, 3_000, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 2_001, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // --- BVA: Total (lifetime) limit boundary ---

    #[test]
    fun test_mcdc_bva_total_at_exact_limit() {
        // total_spent + amount == max_total exactly → should SUCCEED
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT, NO_LIMIT,
            10_000,      // max_total: exactly 10000
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 7000, then 3000 (total: 10000 == limit)
        agent_mandate::validate_and_spend(&mut m, 7_000, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 3_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 10_000);
        assert!(agent_mandate::remaining(&m) == 0);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::ETotalLimitExceeded)]
    fun test_mcdc_bva_total_one_over() {
        // total_spent + amount == max_total + 1 → should FAIL
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT, NO_LIMIT,
            10_000,      // max_total: exactly 10000
            option::some(1_000_000), &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 7000, then 3001 (total: 10001 > 10000)
        agent_mandate::validate_and_spend(&mut m, 7_000, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 3_001, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // --- BVA: Expiry boundary (1ms resolution) ---

    #[test]
    fun test_mcdc_bva_expiry_last_valid_ms() {
        // Spend at now = expires_at - 1 → should SUCCEED
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT, NO_LIMIT, NO_LIMIT,
            option::some(100_000), // expires at 100,000ms
            &clock, ctx,
        );

        // Set clock to 99,999ms — one ms before expiry
        clock::set_for_testing(&mut clock, 99_999);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should succeed — not yet expired
        agent_mandate::validate_and_spend(&mut m, 1_000, &registry, &clock, ctx);
        assert!(agent_mandate::total_spent(&m) == 1_000);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = agent_mandate::EExpired)]
    fun test_mcdc_bva_expiry_exact_ms() {
        // Spend at now = expires_at exactly → should FAIL
        // Code: assert!(now < expires_at), so now == expires_at fails
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT, NO_LIMIT, NO_LIMIT,
            option::some(100_000), // expires at 100,000ms
            &clock, ctx,
        );

        // Set clock to exactly 100,000ms — expiry boundary
        clock::set_for_testing(&mut clock, 100_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — expired at exact boundary
        agent_mandate::validate_and_spend(&mut m, 1_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // PART A: Adversarial Scenario Tests
    // ══════════════════════════════════════════════════════════════

    // ── A1: Registry bypass (H-1 equivalent for AgentMandate) ────
    // Rogue delegate creates their own empty registry to bypass revocation.
    // agent_mandate::validate_and_spend checks registry_owner == mandate.delegator.
    #[test]
    #[expected_failure(abort_code = agent_mandate::ENotDelegator)]
    fun test_adversarial_agent_mandate_registry_bypass() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let mut legit_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,      // L2 capped
            1_000_000_000,    // max_per_tx
            NO_LIMIT,         // daily_limit
            NO_LIMIT,         // weekly_limit
            NO_LIMIT,         // max_total
            option::some(1_000_000),
            &clock, ctx,
        );

        // Delegator revokes
        let mandate_id = object::id(&m);
        mandate::revoke<SUI>(&mut legit_registry, mandate_id, ctx);
        assert!(agent_mandate::is_revoked(&m, &legit_registry));

        // Delegate creates rogue registry (empty — no revocations)
        ts::next_tx(&mut scenario, DELEGATE);
        let rogue_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Spend with rogue registry → MUST fail with ENotDelegator
        agent_mandate::validate_and_spend(&mut m, 100, &rogue_registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(legit_registry);
        mandate::destroy_registry_for_testing(rogue_registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A2: Expired agent mandate spend ──────────────────────────
    #[test]
    #[expected_failure(abort_code = agent_mandate::EExpired)]
    fun test_adversarial_agent_mandate_expired_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            NO_LIMIT, NO_LIMIT, NO_LIMIT, NO_LIMIT,
            option::some(10_000), // expires at 10s
            &clock, ctx,
        );

        // Advance clock past expiry
        clock::set_for_testing(&mut clock, 10_001);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Must fail — mandate expired
        agent_mandate::validate_and_spend(&mut m, 1_000, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A3: Daily cap boundary test ──────────────────────────────
    // Spend exactly to the daily limit, then try one more — should fail.
    // Then advance clock past 24h, verify cap resets.
    #[test]
    fun test_adversarial_agent_mandate_daily_cap_boundary_and_reset() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            100,              // max_per_tx: 100
            200,              // daily_limit: 200
            NO_LIMIT,         // weekly_limit: unlimited
            NO_LIMIT,         // max_total: unlimited
            option::some(100_000_000), // far future
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly daily_limit in two transactions
        agent_mandate::validate_and_spend(&mut m, 100, &registry, &clock, ctx);
        agent_mandate::validate_and_spend(&mut m, 100, &registry, &clock, ctx);
        assert!(agent_mandate::daily_spent(&m) == 200);
        assert!(agent_mandate::daily_remaining(&m) == 0);

        // Advance clock past 24h (86_400_000 ms) to trigger lazy daily reset
        clock::set_for_testing(&mut clock, 86_400_001);

        // Should succeed — daily cap reset
        agent_mandate::validate_and_spend(&mut m, 50, &registry, &clock, ctx);
        assert!(agent_mandate::daily_spent(&m) == 50); // fresh daily counter
        assert!(agent_mandate::total_spent(&m) == 250); // lifetime accumulates

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A3b: Daily cap exceeded (one over) ───────────────────────
    #[test]
    #[expected_failure(abort_code = agent_mandate::EDailyLimitExceeded)]
    fun test_adversarial_agent_mandate_daily_cap_exceeded() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            200,              // max_per_tx: 200
            200,              // daily_limit: 200
            NO_LIMIT, NO_LIMIT,
            option::some(100_000_000),
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly daily_limit
        agent_mandate::validate_and_spend(&mut m, 200, &registry, &clock, ctx);
        assert!(agent_mandate::daily_spent(&m) == 200);

        // Try one more — MUST fail with EDailyLimitExceeded
        agent_mandate::validate_and_spend(&mut m, 1, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A4: Weekly cap boundary test ─────────────────────────────
    #[test]
    #[expected_failure(abort_code = agent_mandate::EWeeklyLimitExceeded)]
    fun test_adversarial_agent_mandate_weekly_cap_exceeded() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            500,              // max_per_tx: 500
            NO_LIMIT,         // daily_limit: unlimited
            500,              // weekly_limit: 500
            NO_LIMIT,         // max_total: unlimited
            option::some(100_000_000),
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly weekly_limit
        agent_mandate::validate_and_spend(&mut m, 500, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 500);

        // Try one more — MUST fail with EWeeklyLimitExceeded
        agent_mandate::validate_and_spend(&mut m, 1, &registry, &clock, ctx);

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A5: Weekly cap reset after 7 days ────────────────────────
    #[test]
    fun test_adversarial_agent_mandate_weekly_cap_reset() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = agent_mandate::create<SUI>(
            DELEGATE, 2,
            500,              // max_per_tx: 500
            NO_LIMIT,         // daily_limit
            500,              // weekly_limit: 500
            NO_LIMIT,         // max_total
            option::some(100_000_000_000), // far future
            &clock, ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Exhaust weekly cap
        agent_mandate::validate_and_spend(&mut m, 500, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 500);
        assert!(agent_mandate::weekly_remaining(&m) == 0);

        // Advance clock past 7 days (604_800_000 ms)
        clock::set_for_testing(&mut clock, 604_800_001);

        // Should succeed — weekly cap reset
        agent_mandate::validate_and_spend(&mut m, 100, &registry, &clock, ctx);
        assert!(agent_mandate::weekly_spent(&m) == 100);
        assert!(agent_mandate::total_spent(&m) == 600); // lifetime accumulates

        agent_mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
