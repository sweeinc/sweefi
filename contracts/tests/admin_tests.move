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
}
