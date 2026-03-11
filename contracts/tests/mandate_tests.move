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
    // MC/DC Coverage Matrix — mandate::validate_and_spend
    // ══════════════════════════════════════════════════════════════
    //
    // Decision: authorize spend (all checks pass → debit)
    //
    // Conditions:
    //   C1: registry.owner == mandate.delegator  (ENotDelegator)
    //   C2: !revoked (df::exists_ check)         (ERevoked)
    //   C3: ctx.sender() == mandate.delegate      (ENotDelegate)
    //   C4: !expired (clock < expires_at)         (EExpired)
    //   C5: amount <= max_per_tx                  (EPerTxLimitExceeded)
    //   C6: total_spent + amount <= max_total     (ETotalLimitExceeded)
    //
    // MC/DC Matrix (N+1 = 7 tests for 6 conditions):
    //
    //   Test             | C1 | C2 | C3 | C4 | C5 | C6 | Result
    //   -----------------+----+----+----+----+----+----+--------
    //   HP (happy path)  |  T |  T |  T |  T |  T |  T | PASS
    //   MC-1 (registry)  |  F |  T |  T |  T |  T |  T | FAIL (ENotDelegator)
    //   MC-2 (revoked)   |  T |  F |  T |  T |  T |  T | FAIL (ERevoked)
    //   MC-3 (sender)    |  T |  T |  F |  T |  T |  T | FAIL (ENotDelegate)
    //   MC-4 (expired)   |  T |  T |  T |  F |  T |  T | FAIL (EExpired)
    //   MC-5 (per_tx)    |  T |  T |  T |  T |  F |  T | FAIL (EPerTxLimitExceeded)
    //   MC-6 (total)     |  T |  T |  T |  T |  T |  F | FAIL (ETotalLimitExceeded)
    //
    // Existing test mapping:
    //   HP:   test_create_and_spend                         ✅
    //   MC-1: test_mcdc_wrong_registry_owner                ✅ (NEW — was a gap)
    //   MC-2: test_no_expiry_mandate_revocation_still_works ✅
    //   MC-3: test_wrong_caller                             ✅
    //   MC-4: test_expired_mandate                          ✅
    //   MC-5: test_per_tx_limit                             ✅
    //   MC-6: test_total_limit                              ✅
    //
    // BVA (Boundary Value Analysis) — 6 tests:
    //   test_mcdc_bva_per_tx_at_exact_limit   (amount == max_per_tx → PASS)
    //   test_mcdc_bva_per_tx_one_over         (amount == max_per_tx + 1 → FAIL)
    //   test_mcdc_bva_total_at_exact_limit    (total_spent + amount == max_total → PASS)
    //   test_mcdc_bva_total_one_over          (total_spent + amount == max_total + 1 → FAIL)
    //   test_mcdc_bva_expiry_last_valid_ms    (now == expires_at - 1 → PASS)
    //   test_mcdc_bva_expiry_exact_ms         (now == expires_at → FAIL)
    //
    // ══════════════════════════════════════════════════════════════

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
            DELEGATE,                   // delegate
            1_000_000_000,              // max_per_tx: 1 SUI
            10_000_000_000,             // max_total: 10 SUI
            option::some(100_000),      // expires_at_ms: 100s from epoch
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
    #[expected_failure(abort_code = mandate::EPerTxLimitExceeded)]
    fun test_per_tx_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,   // max_per_tx: 1 SUI
            10_000_000_000,
            option::some(100_000),
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
    #[expected_failure(abort_code = mandate::ETotalLimitExceeded)]
    fun test_total_limit() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            5_000_000_000,   // max_per_tx: 5 SUI
            2_000_000_000,   // max_total: 2 SUI (lower than per_tx for this test)
            option::some(100_000),
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
    #[expected_failure(abort_code = mandate::EExpired)]
    fun test_expired_mandate() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(50_000), // expires at 50s
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
    #[expected_failure(abort_code = mandate::ENotDelegate)]
    fun test_wrong_caller() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(100_000),
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
            option::some(50_000),
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

        let m = mandate::create<SUI>(DELEGATE, 1_000_000_000, 10_000_000_000, option::some(100_000), &clock, ctx);

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

        let m = mandate::create<SUI>(DELEGATE, 1_000_000_000, 10_000_000_000, option::some(100_000), &clock, ctx);

        // Transfer to THIRD_PARTY (non-delegate)
        transfer::public_transfer(m, THIRD_PARTY);

        // THIRD_PARTY uses destroy_held() — no auth check, zombie cleaned up successfully
        ts::next_tx(&mut scenario, THIRD_PARTY);
        let m = scenario.take_from_sender<mandate::Mandate<SUI>>();
        mandate::destroy_held(m); // any holder can clean up — safe because no funds held

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // No-expiry mandate tests (Option<u64> = None)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_and_spend_no_expiry() {
        // None-expiry mandate works past any timestamp — spending limited only
        // by max_total and revocation, never by clock.
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,         // max_per_tx: 1 SUI
            10_000_000_000,        // max_total: 10 SUI
            option::none(),        // no expiry
            &clock,
            ctx,
        );

        // Advance clock to year 3000 (≈ 32.5 trillion ms)
        clock::set_for_testing(&mut clock, 32_503_680_000_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should succeed — no expiry means clock is irrelevant
        mandate::validate_and_spend(&mut m, 500_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 500_000_000);
        assert!(mandate::remaining(&m) == 9_500_000_000);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_no_expiry_mandate_is_not_expired() {
        // is_expired() returns false for None mandate regardless of clock value.
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::none(),
            &clock,
            ctx,
        );

        // Not expired at creation
        assert!(!mandate::is_expired(&m, &clock));

        // Not expired at year 3000
        clock::set_for_testing(&mut clock, 32_503_680_000_000);
        assert!(!mandate::is_expired(&m, &clock));

        // Verify accessor returns None
        assert!(mandate::expires_at_ms(&m).is_none());

        mandate::destroy_for_testing(m);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // MC-1: Wrong registry owner (C1=F, all others T) — MC/DC GAP FIX
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = mandate::ENotDelegator)]
    fun test_mcdc_wrong_registry_owner() {
        // A rogue delegate creates their own empty registry and passes it
        // to bypass the delegator's revocation. C-2 security check catches this.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(100_000),
            &clock,
            ctx,
        );

        // Delegate creates their OWN registry (owner = DELEGATE, not DELEGATOR)
        ts::next_tx(&mut scenario, DELEGATE);
        let rogue_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Spend with rogue registry → ENotDelegator
        // (registry.owner == DELEGATE != mandate.delegator == DELEGATOR)
        mandate::validate_and_spend(&mut m, 100_000_000, &rogue_registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(rogue_registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::ERevoked)]
    fun test_no_expiry_mandate_revocation_still_works() {
        // Revocation kills a None-expiry mandate. Confirms the kill switch
        // is orthogonal to expiry — the delegator always has an active exit.
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let mut registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::none(),
            &clock,
            ctx,
        );

        // Delegator revokes
        let mandate_id = object::id(&m);
        mandate::revoke<SUI>(&mut registry, mandate_id, ctx);

        // Delegate tries to spend — should fail with ERevoked
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // BVA (Boundary Value Analysis) — off-by-one detection
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_mcdc_bva_per_tx_at_exact_limit() {
        // amount == max_per_tx → PASS (boundary: <=)
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,         // max_per_tx: exactly 1 SUI
            10_000_000_000,
            option::some(100_000),
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly max_per_tx — should succeed
        mandate::validate_and_spend(&mut m, 1_000_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 1_000_000_000);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::EPerTxLimitExceeded)]
    fun test_mcdc_bva_per_tx_one_over() {
        // amount == max_per_tx + 1 → FAIL (boundary: off-by-one)
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(100_000),
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend max_per_tx + 1 MIST — should fail
        mandate::validate_and_spend(&mut m, 1_000_000_001, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_mcdc_bva_total_at_exact_limit() {
        // total_spent + amount == max_total → PASS (boundary: <=)
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            5_000_000_000,         // max_per_tx: 5 SUI (high enough)
            2_000_000_000,         // max_total: 2 SUI
            option::some(100_000),
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend exactly max_total in one go — should succeed
        mandate::validate_and_spend(&mut m, 2_000_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 2_000_000_000);
        assert!(mandate::remaining(&m) == 0);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::ETotalLimitExceeded)]
    fun test_mcdc_bva_total_one_over() {
        // total_spent + amount == max_total + 1 → FAIL (boundary: off-by-one)
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            5_000_000_000,
            2_000_000_000,         // max_total: 2 SUI
            option::some(100_000),
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend max_total + 1 MIST — should fail
        mandate::validate_and_spend(&mut m, 2_000_000_001, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_mcdc_bva_expiry_last_valid_ms() {
        // now == expires_at - 1 → PASS (clock < expires_at)
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(50_000),  // expires at 50,000ms
            &clock,
            ctx,
        );

        // Set clock to 1ms before expiry
        clock::set_for_testing(&mut clock, 49_999);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should succeed — last valid millisecond
        mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 100_000_000);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::EExpired)]
    fun test_mcdc_bva_expiry_exact_ms() {
        // now == expires_at → FAIL (clock < expires_at is false when equal)
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(50_000),  // expires at 50,000ms
            &clock,
            ctx,
        );

        // Set clock to exactly expiry time
        clock::set_for_testing(&mut clock, 50_000);

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Should fail — expires_at is exclusive (strict less-than)
        mandate::validate_and_spend(&mut m, 100_000_000, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // PART A: Adversarial Scenario Tests
    // ══════════════════════════════════════════════════════════════

    // ── A1: Cap bypass via many small transactions ───────────────
    // Can an agent bypass per_tx limit by making many small transactions?
    // Each individual 1-unit transaction is within per_tx, but they should
    // all succeed until the lifetime cap is hit — then fail.
    #[test]
    #[expected_failure(abort_code = mandate::ETotalLimitExceeded)]
    fun test_adversarial_mandate_cap_bypass_many_small_txs() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // per_tx=50, max_total=100
        // Agent can do 100 transactions of 1 each (all within per_tx=50)
        // but total_spent will hit max_total=100 on the 101st
        let mut m = mandate::create<SUI>(
            DELEGATE,
            50,               // max_per_tx: 50
            100,              // max_total: 100
            option::some(1_000_000), // far future expiry
            &clock,
            ctx,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);

        // Spend 100 times (1 each) — all succeed, total_spent reaches 100
        let mut i = 0u64;
        while (i < 100) {
            mandate::validate_and_spend(&mut m, 1, &registry, &clock, ctx);
            i = i + 1;
        };
        assert!(mandate::total_spent(&m) == 100);
        assert!(mandate::remaining(&m) == 0);

        // 101st attempt — even 1 unit exceeds lifetime cap
        mandate::validate_and_spend(&mut m, 1, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A2: Registry bypass (V8 H-1 fix) ────────────────────────
    // Can a rogue delegate pass their OWN empty registry to bypass revocation?
    // The registry ownership check (registry.owner == mandate.delegator) catches this.
    #[test]
    #[expected_failure(abort_code = mandate::ENotDelegator)]
    fun test_adversarial_mandate_registry_bypass() {
        let mut scenario = ts::begin(DELEGATOR);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let mut legit_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(100_000),
            &clock,
            ctx,
        );

        // Delegator revokes the mandate in the LEGITIMATE registry
        let mandate_id = object::id(&m);
        mandate::revoke<SUI>(&mut legit_registry, mandate_id, ctx);

        // Verify revocation worked in legit registry
        assert!(mandate::is_revoked(&m, &legit_registry));

        // Delegate creates their OWN rogue registry (empty — no revocations)
        ts::next_tx(&mut scenario, DELEGATE);
        let rogue_registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        // Delegate confirms mandate is NOT revoked in their rogue registry
        assert!(!mandate::is_revoked(&m, &rogue_registry));

        // Delegate tries to spend with rogue registry → MUST fail with ENotDelegator
        // because rogue_registry.owner == DELEGATE != mandate.delegator == DELEGATOR
        mandate::validate_and_spend(&mut m, 100_000_000, &rogue_registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(legit_registry);
        mandate::destroy_registry_for_testing(rogue_registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ── A3: Expired mandate spend ────────────────────────────────
    // Can an agent spend from an expired mandate? Should fail with EExpired.
    // (Reinforces existing test_expired_mandate but with explicit adversarial framing)
    #[test]
    #[expected_failure(abort_code = mandate::EExpired)]
    fun test_adversarial_mandate_expired_spend() {
        let mut scenario = ts::begin(DELEGATOR);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let registry = mandate::create_registry_for_testing(ts::ctx(&mut scenario));
        let ctx = ts::ctx(&mut scenario);

        let mut m = mandate::create<SUI>(
            DELEGATE,
            1_000_000_000,
            10_000_000_000,
            option::some(10_000), // expires at 10s
            &clock,
            ctx,
        );

        // First spend succeeds (before expiry)
        ts::next_tx(&mut scenario, DELEGATE);
        let ctx = ts::ctx(&mut scenario);
        mandate::validate_and_spend(&mut m, 100, &registry, &clock, ctx);
        assert!(mandate::total_spent(&m) == 100);

        // Advance clock past expiry
        clock::set_for_testing(&mut clock, 10_001);

        // Attacker tries to spend after expiry — MUST fail
        mandate::validate_and_spend(&mut m, 100, &registry, &clock, ctx);

        mandate::destroy_for_testing(m);
        mandate::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
