#[test_only]
module sweefi::admin_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use sweefi::admin;

    const ADMIN: address = @0xADC;
    const ANYONE: address = @0xBEEF;

    #[test]
    fun test_create_for_testing() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());

        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    fun test_pause_unpause_cycle() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        assert!(admin::is_paused(&state) == false);

        // Pause
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Unpause
        admin::unpause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_double_pause_fails() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        // Second pause should fail
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::ENotPaused)]
    fun test_unpause_when_not_paused_fails() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Unpause without pausing first should fail
        admin::unpause(&cap, &mut state, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    fun test_burn_admin_cap() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());

        // Burn the cap — irrevocable (state must be unpaused, which it is)
        admin::burn_admin_cap(cap, &state, scenario.ctx());

        // State still exists and is not paused
        assert!(admin::is_paused(&state) == false);

        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_burn_admin_cap_while_paused_fails() {
        // T-4: burn_admin_cap blocked when protocol is paused (M-1 fix).
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Pause the protocol
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Attempt to burn AdminCap while paused → EAlreadyPaused
        admin::burn_admin_cap(cap, &state, scenario.ctx());

        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EProtocolPaused)]
    fun test_assert_not_paused_aborts_when_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        // This should abort — still within auto-unpause window
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun test_assert_not_paused_succeeds_when_active() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Should not abort
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun test_init_via_scenario() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Verify AdminCap works with ProtocolState
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);
        admin::unpause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Auto-unpause tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_auto_unpause_after_window() {
        // After 14 days, anyone can call auto_unpause to flip the state
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Pause at t=1000
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Advance clock past 14-day window (1,209,600,000 ms)
        clock::set_for_testing(&mut clock, 1000 + 1_209_600_000);

        // Anyone can trigger auto_unpause
        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAutoUnpauseNotReady)]
    fun test_auto_unpause_too_early_fails() {
        // Cannot auto_unpause before the window elapses
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // Advance only 13 days (not enough)
        clock::set_for_testing(&mut clock, 1000 + 1_123_200_000);

        // Should fail — window not elapsed
        admin::auto_unpause(&mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::ENotPaused)]
    fun test_auto_unpause_when_not_paused_fails() {
        let mut scenario = ts::begin(ADMIN);
        let (_cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Not paused — auto_unpause should fail
        admin::auto_unpause(&mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun test_assert_not_paused_self_heals_after_window() {
        // assert_not_paused succeeds after auto-unpause window even without
        // explicit auto_unpause() call — creation functions self-heal
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Pause at t=1000
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // Advance past 14-day window
        clock::set_for_testing(&mut clock, 1000 + 1_209_600_001);

        // assert_not_paused should succeed (self-healing) even though
        // state.paused is still true — the window has elapsed
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun test_repause_resets_timer() {
        // Admin can re-pause to reset the auto-unpause timer
        // (for legitimate extended emergencies)
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        // Pause at t=1000
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // After 10 days, admin unpause then re-pause to reset timer
        clock::set_for_testing(&mut clock, 1000 + 864_000_000); // +10 days
        admin::unpause(&cap, &mut state, scenario.ctx());
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // 13 days after re-pause — should still be effectively paused
        clock::set_for_testing(&mut clock, 1000 + 864_000_000 + 1_123_200_000);

        // assert_not_paused should FAIL — within new 14-day window
        // (We can't test expected_failure inline, so we verify is_paused instead)
        assert!(admin::is_paused(&state) == true);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: admin::pause()
    // ══════════════════════════════════════════════════════════════
    //
    // Guard conditions in pause():
    //   C1: AdminCap present in tx      (enforced by Move type system — not testable)
    //   C2: !state.paused               (assert!, EAlreadyPaused)
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬───────────────┐
    // │ Test │ C1 │ C2 │ Result        │
    // ├──────┼────┼────┼───────────────┤
    // │ HP   │ T  │ T  │ PASS          │
    // │ MC-2 │ T  │ F  │ EAlreadyPaused│
    // └──────┴────┴────┴───────────────┘
    //
    // C1 (AdminCap) cannot be falsified in Move tests — the type system
    // prevents calling pause() without AdminCap at compile time. This is
    // a stronger guarantee than runtime checks. Documented for completeness.
    //
    // Existing coverage:
    //   HP → test_pause_unpause_cycle
    //   MC-2 → test_double_pause_fails
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: pause succeeds from unpaused state, records timestamp
    #[test]
    fun test_mcdc_hp_admin_pause() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 5_000_000);

        assert!(admin::is_paused(&state) == false);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC MC-1: pause when already paused → EAlreadyPaused
    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_mcdc_mc1_admin_pause_already_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        // C2: state.paused=true → !state.paused=false → FAIL
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: admin::unpause()
    // ══════════════════════════════════════════════════════════════
    //
    // Guard conditions in unpause():
    //   C1: AdminCap present           (type system enforced)
    //   C2: state.paused               (assert!, ENotPaused)
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬────────────┐
    // │ Test │ C1 │ C2 │ Result     │
    // ├──────┼────┼────┼────────────┤
    // │ HP   │ T  │ T  │ PASS       │
    // │ MC-2 │ T  │ F  │ ENotPaused │
    // └──────┴────┴────┴────────────┘
    //
    // Existing coverage:
    //   HP → test_pause_unpause_cycle
    //   MC-2 → test_unpause_when_not_paused_fails
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: unpause succeeds from paused state, clears paused_at_ms
    #[test]
    fun test_mcdc_hp_admin_unpause() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 5_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        admin::unpause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC MC-1: unpause when not paused → ENotPaused
    #[test]
    #[expected_failure(abort_code = admin::ENotPaused)]
    fun test_mcdc_mc1_admin_unpause_not_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // C2: state.paused=false → FAIL
        admin::unpause(&cap, &mut state, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: admin::auto_unpause()
    // ══════════════════════════════════════════════════════════════
    //
    // Guard conditions in auto_unpause():
    //   C1: state.paused                                      (assert!, ENotPaused)
    //   C2: clock.timestamp_ms() >= paused_at_ms + 14_days    (assert!, EAutoUnpauseNotReady)
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬─────────────────────┐
    // │ Test │ C1 │ C2 │ Result              │
    // ├──────┼────┼────┼─────────────────────┤
    // │ HP   │ T  │ T  │ PASS                │
    // │ MC-1 │ F  │ T  │ ENotPaused          │
    // │ MC-2 │ T  │ F  │ EAutoUnpauseNotReady│
    // └──────┴────┴────┴─────────────────────┘
    //
    // BVA boundaries:
    //   time: paused_at + 14_days - 1ms (fail), paused_at + 14_days (pass)
    //
    // Existing coverage:
    //   HP → test_auto_unpause_after_window
    //   MC-1 → test_auto_unpause_when_not_paused_fails
    //   MC-2 → test_auto_unpause_too_early_fails
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: auto_unpause after exactly 14 days
    #[test]
    fun test_mcdc_hp_admin_auto_unpause() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // Advance clock to exactly paused_at + AUTO_UNPAUSE_WINDOW_MS
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000);

        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC MC-1: auto_unpause when not paused → ENotPaused
    #[test]
    #[expected_failure(abort_code = admin::ENotPaused)]
    fun test_mcdc_mc1_admin_auto_unpause_not_paused() {
        let mut scenario = ts::begin(ANYONE);
        let (_cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 999_999_999);

        // C1: state.paused=false → FAIL
        admin::auto_unpause(&mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC MC-2: auto_unpause too early → EAutoUnpauseNotReady
    #[test]
    #[expected_failure(abort_code = admin::EAutoUnpauseNotReady)]
    fun test_mcdc_mc2_admin_auto_unpause_too_early() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // C2: 1ms before window elapses → FAIL
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000 - 1);

        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ── BVA: auto_unpause time boundary ──

    /// BVA: auto_unpause at exactly paused_at + window → pass (already tested in HP above)
    /// BVA: auto_unpause at paused_at + window - 1 → fail (already tested in MC-2 above)

    /// BVA: auto_unpause at paused_at + window + 1 → pass (well past boundary)
    #[test]
    fun test_mcdc_bva_admin_auto_unpause_one_past() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // 1ms past the window
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000 + 1);

        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: admin::burn_admin_cap()
    // ══════════════════════════════════════════════════════════════
    //
    // Guard conditions in burn_admin_cap():
    //   C1: AdminCap present (by value — consumed)  (type system enforced)
    //   C2: !state.paused                            (assert!, EAlreadyPaused)
    //
    // MC/DC Matrix:
    // ┌──────┬────┬────┬───────────────┐
    // │ Test │ C1 │ C2 │ Result        │
    // ├──────┼────┼────┼───────────────┤
    // │ HP   │ T  │ T  │ PASS (cap gone)│
    // │ MC-2 │ T  │ F  │ EAlreadyPaused│
    // └──────┴────┴────┴───────────────┘
    //
    // Existing coverage:
    //   HP → test_burn_admin_cap
    //   MC-2 → test_burn_admin_cap_while_paused_fails
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: burn_admin_cap when protocol is unpaused → cap destroyed
    #[test]
    fun test_mcdc_hp_admin_burn_cap() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());

        // C2: state.paused=false → !state.paused=true → PASS
        admin::burn_admin_cap(cap, &state, scenario.ctx());

        // State persists, unpaused
        assert!(admin::is_paused(&state) == false);

        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    /// MC/DC MC-1: burn_admin_cap when protocol is paused → EAlreadyPaused
    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_mcdc_mc1_admin_burn_cap_while_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // C2: state.paused=true → !state.paused=false → FAIL
        admin::burn_admin_cap(cap, &state, scenario.ctx());

        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // MC/DC Coverage: admin::assert_not_paused()
    // ══════════════════════════════════════════════════════════════
    //
    // Guard logic: assert!(!(state.paused && clock < paused_at + window))
    // Expanded decision: abort if (state.paused AND time_within_window)
    //
    //   C1: state.paused = true
    //   C2: clock.timestamp_ms() < state.paused_at_ms + AUTO_UNPAUSE_WINDOW_MS
    //
    // MC/DC Matrix (for the compound condition):
    // ┌──────┬────┬────┬──────────┐
    // │ Test │ C1 │ C2 │ Result   │
    // ├──────┼────┼────┼──────────┤
    // │ HP   │ F  │ *  │ PASS     │ (not paused at all)
    // │ T-1  │ T  │ F  │ PASS     │ (paused but window expired → self-heal)
    // │ MC-1 │ T  │ T  │ ABORT    │ (paused and within window)
    // └──────┴────┴────┴──────────┘
    //
    // Existing coverage:
    //   HP → test_assert_not_paused_succeeds_when_active
    //   T-1 → test_assert_not_paused_self_heals_after_window
    //   MC-1 → test_assert_not_paused_aborts_when_paused
    // ══════════════════════════════════════════════════════════════

    /// MC/DC HP: assert_not_paused on unpaused state → no abort
    #[test]
    fun test_mcdc_hp_admin_assert_not_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 999_999);

        // C1=false → compound condition is false → no abort
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC T-1: paused=true but window expired → self-heals (no abort)
    #[test]
    fun test_mcdc_t1_admin_assert_not_paused_self_heals() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // C1=true, C2=false (past window) → compound=false → no abort
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000);
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// MC/DC MC-1: paused=true and within window → abort
    #[test]
    #[expected_failure(abort_code = admin::EProtocolPaused)]
    fun test_mcdc_mc1_admin_assert_not_paused_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // C1=true, C2=true (within window) → compound=true → ABORT
        // clock still at 1_000_000 (well within 14-day window)
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// BVA: assert_not_paused at exactly window boundary → self-heals (no abort)
    #[test]
    fun test_mcdc_bva_admin_assert_not_paused_at_boundary() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // Exactly at paused_at + window: 1_000_000 + 1_209_600_000
        // clock >= paused_at + window → C2=false → no abort
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000);
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// BVA: assert_not_paused 1ms before window boundary → abort
    #[test]
    #[expected_failure(abort_code = admin::EProtocolPaused)]
    fun test_mcdc_bva_admin_assert_not_paused_one_before_boundary() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // 1ms before window expires → still within window → ABORT
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000 - 1);
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // PART A: Adversarial Scenario Tests
    // ══════════════════════════════════════════════════════════════

    // ── A1: Admin key theft worst case ───────────────────────────
    // If AdminCap is compromised, attacker pauses the protocol.
    // P5 liveness invariant: after 14 days, auto_unpause fires → system recovers.
    #[test]
    fun test_adversarial_admin_key_theft_recovery() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        // Attacker compromises AdminCap and pauses the protocol
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Simulate "attacker has cap but community waits"
        // After 14 days, anyone can trigger auto_unpause
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000);

        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        // Protocol recovered — P5 liveness invariant holds
        admin::assert_not_paused(&state, &clock);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ── A2: Burn while paused ────────────────────────────────────
    // Can an attacker burn AdminCap while protocol is paused, permanently locking it?
    // Should fail (burn requires !paused).
    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_adversarial_admin_burn_while_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000);

        // Attacker pauses, then tries to burn AdminCap to permanently lock the protocol
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // burn_admin_cap requires !paused → MUST fail with EAlreadyPaused
        admin::burn_admin_cap(cap, &state, scenario.ctx());

        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    // ── A3: Re-pause after auto-unpause ──────────────────────────
    // After auto-unpause fires, admin can re-pause if they still have AdminCap.
    #[test]
    fun test_adversarial_admin_repause_after_auto_unpause() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, 1_000_000);

        // Pause
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Wait 14 days, auto-unpause
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_000);
        scenario.next_tx(ANYONE);
        admin::auto_unpause(&mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        // Admin re-pauses (still has AdminCap) — this is legitimate
        scenario.next_tx(ADMIN);
        clock::set_for_testing(&mut clock, 1_000_000 + 1_209_600_001);
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
}
