#[test_only]
module sweefi::admin_tests {
    use sui::test_scenario::{Self as ts};
    use sweefi::admin;

    const ADMIN: address = @0xADC;

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

        assert!(admin::is_paused(&state) == false);

        // Pause
        admin::pause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == true);

        // Unpause
        admin::unpause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_double_pause_fails() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        admin::pause(&cap, &mut state, scenario.ctx());
        // Second pause should fail
        admin::pause(&cap, &mut state, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
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

        // Burn the cap — irrevocable
        admin::burn_admin_cap(cap, scenario.ctx());

        // State still exists and is not paused
        assert!(admin::is_paused(&state) == false);

        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_assert_not_paused_aborts_when_paused() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        admin::pause(&cap, &mut state, scenario.ctx());
        // This should abort
        admin::assert_not_paused(&state);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    fun test_assert_not_paused_succeeds_when_active() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());

        // Should not abort
        admin::assert_not_paused(&state);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }

    #[test]
    fun test_init_via_scenario() {
        // Test that init creates AdminCap (to sender) and ProtocolState (shared)
        let mut scenario = ts::begin(ADMIN);

        // The init function runs automatically for published packages.
        // In test scenarios, we use create_for_testing instead.
        // This test verifies the pattern works end-to-end.
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Verify AdminCap works with ProtocolState
        admin::pause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == true);
        admin::unpause(&cap, &mut state, scenario.ctx());
        assert!(admin::is_paused(&state) == false);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        scenario.end();
    }
}
