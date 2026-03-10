#[test_only]
module sweefi::identity_tests {
    use sui::test_scenario as ts;
    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sweefi::identity;
    use sweefi::payment;
    use sweefi::admin;

    const AGENT: address = @0xA1;
    const AGENT_B: address = @0xA2;
    const MERCHANT: address = @0xBEEF;
    const FEE_RECIPIENT: address = @0xFEE;
    const ADMIN: address = @0xADC;

    // ══════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════

    /// Mint a PaymentReceipt for testing (executes a real payment)
    fun mint_receipt(
        scenario: &mut ts::Scenario,
        clock: &clock::Clock,
    ): payment::PaymentReceipt {
        let coin = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        payment::pay<SUI>(
            coin,
            MERCHANT,
            1_000_000,     // 1M MIST
            0,             // no fee
            FEE_RECIPIENT,
            b"test",
            clock,
            scenario.ctx(),
        )
    }

    // ══════════════════════════════════════════════════════════════
    // Positive path tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    /// Create identity and verify all fields initialized correctly
    fun test_create_identity() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(5_000); // 5 seconds
        let state = admin::create_state_for_testing(scenario.ctx());

        let mut registry = identity::create_registry_for_testing(scenario.ctx());
        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        assert!(identity::owner(&id) == AGENT);
        assert!(identity::created_at_ms(&id) == 5_000);
        assert!(identity::total_payments(&id) == 0);
        assert!(identity::total_volume(&id) == 0);
        assert!(identity::last_active_ms(&id) == 5_000);

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Create identity and verify registry lookup returns correct ID
    fun test_registry_lookup() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        let identity_id = object::id(&id);

        // Lookup should return the identity's object ID
        let found = identity::lookup(&registry, AGENT);
        assert!(found.is_some());
        assert!(*found.borrow() == identity_id);
        assert!(identity::is_registered(&registry, AGENT));

        // Unregistered address returns None
        assert!(identity::lookup(&registry, AGENT_B).is_none());
        assert!(!identity::is_registered(&registry, AGENT_B));

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Record a payment and verify counters increment
    fun test_record_payment() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        let receipt = mint_receipt(&mut scenario, &clock);

        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());

        assert!(identity::total_payments(&id) == 1);
        assert!(identity::total_volume(&id) == 1_000_000);

        transfer::public_transfer(receipt, AGENT);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Record multiple payments and verify cumulative totals
    fun test_multiple_payments_cumulative() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // Record 3 payments
        let r1 = mint_receipt(&mut scenario, &clock);
        identity::record_payment(&mut id, &r1, &clock, scenario.ctx());

        let r2 = mint_receipt(&mut scenario, &clock);
        identity::record_payment(&mut id, &r2, &clock, scenario.ctx());

        let r3 = mint_receipt(&mut scenario, &clock);
        identity::record_payment(&mut id, &r3, &clock, scenario.ctx());

        assert!(identity::total_payments(&id) == 3);
        assert!(identity::total_volume(&id) == 3_000_000); // 3 * 1M MIST

        transfer::public_transfer(r1, AGENT);
        transfer::public_transfer(r2, AGENT);
        transfer::public_transfer(r3, AGENT);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// is_active returns true within threshold, false outside
    fun test_is_active() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(10_000); // created at 10s
        let state = admin::create_state_for_testing(scenario.ctx());

        let mut registry = identity::create_registry_for_testing(scenario.ctx());
        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // At creation time, active within any threshold
        assert!(identity::is_active(&id, &clock, 1_000));

        // Advance clock 5 seconds
        clock.set_for_testing(15_000);
        assert!(identity::is_active(&id, &clock, 10_000));  // 5s < 10s threshold
        assert!(!identity::is_active(&id, &clock, 3_000));  // 5s > 3s threshold

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// age_ms computes correctly as clock advances
    fun test_age_ms() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(1_000); // created at 1s
        let state = admin::create_state_for_testing(scenario.ctx());

        let mut registry = identity::create_registry_for_testing(scenario.ctx());
        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        assert!(identity::age_ms(&id, &clock) == 0);

        clock.set_for_testing(6_000); // now 6s
        assert!(identity::age_ms(&id, &clock) == 5_000); // 6s - 1s = 5s

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Two different addresses can both create identities
    fun test_two_agents_create() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        // Agent A creates identity
        let id_a = identity::create(&mut registry, &state, &clock, scenario.ctx());
        assert!(identity::owner(&id_a) == AGENT);

        // Switch to Agent B
        ts::next_tx(&mut scenario, AGENT_B);
        let id_b = identity::create(&mut registry, &state, &clock, scenario.ctx());
        assert!(identity::owner(&id_b) == AGENT_B);

        // Both registered
        assert!(identity::is_registered(&registry, AGENT));
        assert!(identity::is_registered(&registry, AGENT_B));

        // Different IDs
        assert!(object::id(&id_a) != object::id(&id_b));

        identity::destroy_for_testing(id_a);
        identity::destroy_for_testing(id_b);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// AdminCap-gated registry creation via the real entry function
    fun test_admin_create_registry() {
        let mut scenario = ts::begin(ADMIN);
        let (cap, state) = admin::create_for_testing(scenario.ctx());

        // Call the actual entry function with AdminCap
        identity::create_registry(&cap, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);

        // Registry is now shared — retrieve it in the next tx
        ts::next_tx(&mut scenario, ADMIN);
        let registry = ts::take_shared<identity::IdentityRegistry>(&scenario);
        assert!(!identity::is_registered(&registry, AGENT));
        ts::return_shared(registry);

        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Negative path tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = identity::EAlreadyRegistered)]
    /// Cannot create two identities for the same address
    fun test_duplicate_identity_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let id1 = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // Second create should fail
        let id2 = identity::create(&mut registry, &state, &clock, scenario.ctx());

        identity::destroy_for_testing(id1);
        identity::destroy_for_testing(id2);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = identity::ENotOwner)]
    /// Non-owner cannot record payment on someone else's identity
    fun test_non_owner_record_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // Switch to a different sender
        ts::next_tx(&mut scenario, AGENT_B);
        // Agent B makes a payment (receipt has Agent B as payer)
        let receipt = mint_receipt(&mut scenario, &clock);

        // Agent B tries to record on Agent A's identity — should fail (wrong sender)
        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());

        transfer::public_transfer(receipt, AGENT_B);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = identity::EIdentityMismatch)]
    /// Receipt payer must match identity owner
    fun test_receipt_mismatch_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // Agent B makes a payment (receipt.payer = Agent B)
        ts::next_tx(&mut scenario, AGENT_B);
        let receipt = mint_receipt(&mut scenario, &clock);

        // Switch back to Agent A (identity owner)
        ts::next_tx(&mut scenario, AGENT);
        // Agent A tries to record Agent B's receipt — should fail (payer mismatch)
        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());

        transfer::public_transfer(receipt, AGENT_B);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Lookup for unregistered address returns None
    fun test_lookup_unregistered_returns_none() {
        let mut scenario = ts::begin(AGENT);
        let registry = identity::create_registry_for_testing(scenario.ctx());

        let result = identity::lookup(&registry, AGENT);
        assert!(result.is_none());
        assert!(!identity::is_registered(&registry, AGENT));

        identity::destroy_registry_for_testing(registry);
        scenario.end();
    }

    #[test]
    /// Record payment updates last_active_ms to current clock time
    fun test_record_updates_last_active() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(1_000); // created at 1s
        let state = admin::create_state_for_testing(scenario.ctx());

        let mut registry = identity::create_registry_for_testing(scenario.ctx());
        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        assert!(identity::last_active_ms(&id) == 1_000);

        // Advance clock, record payment
        clock.set_for_testing(10_000);
        let receipt = mint_receipt(&mut scenario, &clock);
        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());

        // last_active should update to 10s
        assert!(identity::last_active_ms(&id) == 10_000);

        transfer::public_transfer(receipt, AGENT);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// Registry lookup returns correct ID after creation
    fun test_registry_returns_correct_id() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        let expected_id = object::id(&id);

        let found = identity::lookup(&registry, AGENT);
        assert!(found.is_some());
        assert!(*found.borrow() == expected_id);

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Receipt replay prevention tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = identity::EReceiptAlreadyRecorded)]
    /// Same receipt cannot be recorded twice — prevents reputation inflation
    fun test_receipt_replay_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let mut id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        let receipt = mint_receipt(&mut scenario, &clock);

        // First recording succeeds
        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());
        assert!(identity::total_payments(&id) == 1);

        // Second recording of SAME receipt should abort
        identity::record_payment(&mut id, &receipt, &clock, scenario.ctx());

        transfer::public_transfer(receipt, AGENT);
        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Protocol pause tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = admin::EProtocolPaused)]
    /// Identity creation blocked when protocol is paused
    fun test_create_while_paused_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        // Try to create identity — should fail
        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        identity::destroy_for_testing(id);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Destroy / deregister tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    /// Owner can destroy their identity and it deregisters from registry
    fun test_destroy_identity() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());
        assert!(identity::is_registered(&registry, AGENT));

        // Owner destroys their identity
        identity::destroy(id, &mut registry, scenario.ctx());

        // Should be deregistered
        assert!(!identity::is_registered(&registry, AGENT));
        assert!(identity::lookup(&registry, AGENT).is_none());

        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = identity::ENotOwner)]
    /// Non-owner cannot destroy someone else's identity
    fun test_destroy_non_owner_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        let id = identity::create(&mut registry, &state, &clock, scenario.ctx());

        // Switch to a different sender
        ts::next_tx(&mut scenario, AGENT_B);
        // Agent B tries to destroy Agent A's identity — should fail
        identity::destroy(id, &mut registry, scenario.ctx());

        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    /// After destroy, the same address can create a new identity
    fun test_recreate_after_destroy() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let state = admin::create_state_for_testing(scenario.ctx());
        let mut registry = identity::create_registry_for_testing(scenario.ctx());

        // Create and destroy
        let id1 = identity::create(&mut registry, &state, &clock, scenario.ctx());
        let id1_obj = object::id(&id1);
        identity::destroy(id1, &mut registry, scenario.ctx());
        assert!(!identity::is_registered(&registry, AGENT));

        // Re-create — should succeed
        let id2 = identity::create(&mut registry, &state, &clock, scenario.ctx());
        assert!(identity::is_registered(&registry, AGENT));
        // New identity has a different object ID
        assert!(object::id(&id2) != id1_obj);

        identity::destroy_for_testing(id2);
        identity::destroy_registry_for_testing(registry);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
