#[test_only]
module sweefi::upto_deposit_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweefi::upto_deposit;
    use sweefi::admin;

    const PAYER: address = @0xCAFE;
    const RECIPIENT: address = @0xBEEF;
    const FEE_RECIPIENT: address = @0xFEE;
    const STRANGER: address = @0xDEAD;

    // Deadline: 1 hour from clock=0 (3,600,000 ms)
    const DEADLINE_MS: u64 = 3_600_000;

    // ══════════════════════════════════════════════════════════════
    // Create tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_upto_deposit() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());

        upto_deposit::create<SUI>(
            deposit,
            RECIPIENT,
            DEADLINE_MS,
            5_000,          // 0.5% fee
            FEE_RECIPIENT,
            &state,
            &clock,
            scenario.ctx(),
        );

        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        assert!(upto_deposit::deposit_payer(&d) == PAYER);
        assert!(upto_deposit::deposit_recipient(&d) == RECIPIENT);
        assert!(upto_deposit::deposit_balance(&d) == 5_000_000);
        assert!(upto_deposit::deposit_max_amount(&d) == 5_000_000);
        assert!(upto_deposit::deposit_settlement_ceiling(&d) == 0); // no ceiling
        assert!(upto_deposit::deposit_settlement_deadline_ms(&d) == DEADLINE_MS);
        assert!(upto_deposit::deposit_state(&d) == upto_deposit::state_pending());
        assert!(upto_deposit::deposit_fee_micro_pct(&d) == 5_000);

        ts::return_shared(d);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_create_with_ceiling() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());

        upto_deposit::create_with_ceiling<SUI>(
            deposit,
            RECIPIENT,
            3_000_000,      // ceiling lower than deposit
            DEADLINE_MS,
            5_000,
            FEE_RECIPIENT,
            &state,
            &clock,
            scenario.ctx(),
        );

        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        assert!(upto_deposit::deposit_settlement_ceiling(&d) == 3_000_000);
        assert!(upto_deposit::deposit_max_amount(&d) == 5_000_000);

        ts::return_shared(d);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_create_ceiling_equals_max() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());

        // Ceiling == max_amount is valid (functionally same as no ceiling)
        upto_deposit::create_with_ceiling<SUI>(
            deposit,
            RECIPIENT,
            5_000_000,
            DEADLINE_MS,
            0,
            FEE_RECIPIENT,
            &state,
            &clock,
            scenario.ctx(),
        );

        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        assert!(upto_deposit::deposit_settlement_ceiling(&d) == 5_000_000);

        ts::return_shared(d);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EZeroAmount)]
    fun test_create_below_min_deposit_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(999_999, scenario.ctx());

        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineInPast)]
    fun test_create_deadline_in_past_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        clock.set_for_testing(5_000_000);

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        upto_deposit::create<SUI>(
            deposit, RECIPIENT, 1_000_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EInvalidFeeMicroPct)]
    fun test_create_invalid_fee_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 1_000_001, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EPayerIsRecipient)]
    fun test_create_payer_is_recipient_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        upto_deposit::create<SUI>(
            deposit, PAYER, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ECeilingExceedsMax)]
    fun test_create_ceiling_exceeds_max_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        upto_deposit::create_with_ceiling<SUI>(
            deposit, RECIPIENT, 2_000_000, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ECeilingExceedsMax)]
    fun test_create_ceiling_zero_with_ceiling_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // ceiling=0 via create_with_ceiling should fail (use create() for no ceiling)
        upto_deposit::create_with_ceiling<SUI>(
            deposit, RECIPIENT, 0, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Settle tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_settle_full_amount() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Recipient settles for full amount
        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_000, &clock, scenario.ctx());

        // Verify recipient got the funds (fee=0, so full amount)
        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 5_000_000);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_partial_amount_with_refund() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Recipient settles for 2M (3M refunded to payer)
        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 2_000_000, &clock, scenario.ctx());

        // Verify recipient got 2M
        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 2_000_000);
        coin::burn_for_testing(received);

        // Verify payer got 3M refund
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 3_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_with_fee() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // 10_000 micro-pct = 1%
        let deposit = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 10_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Settle for 5M → fee = 50,000 (1%), recipient gets 4,950,000, payer refunded 5M
        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_000, &clock, scenario.ctx());

        // Verify fee recipient got 50,000
        scenario.next_tx(FEE_RECIPIENT);
        let fee = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee.value() == 50_000);
        coin::burn_for_testing(fee);

        // Verify recipient got 4,950,000
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 4_950_000);
        coin::burn_for_testing(received);

        // Verify payer got 5M refund
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 5_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_respects_ceiling() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create_with_ceiling<SUI>(
            deposit, RECIPIENT, 3_000_000, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Settle for exactly the ceiling amount — should succeed
        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 3_000_000, &clock, scenario.ctx());

        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 3_000_000);
        coin::burn_for_testing(received);

        // Payer gets 2M refund
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 2_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ESettleAmountTooHigh)]
    fun test_settle_above_ceiling_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create_with_ceiling<SUI>(
            deposit, RECIPIENT, 3_000_000, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Try to settle above ceiling — should fail
        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 3_000_001, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ESettleAmountTooHigh)]
    fun test_settle_above_max_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_001, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ESettleAmountZero)]
    fun test_settle_zero_amount_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 0, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ENotRecipient)]
    fun test_settle_not_recipient_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Stranger tries to settle
        scenario.next_tx(STRANGER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::ENotRecipient)]
    fun test_settle_payer_cannot_settle() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Payer tries to settle their own deposit — not allowed
        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_zero_fee_no_fee_transfer() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // fee = 0 → no fee transfer should occur
        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_000, &clock, scenario.ctx());

        // Full amount to recipient, nothing to fee_recipient
        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 5_000_000);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Expire tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_expire_after_deadline() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 5_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Advance clock past deadline
        clock.set_for_testing(DEADLINE_MS);

        // Anyone can expire (permissionless)
        scenario.next_tx(STRANGER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        // Full refund to payer (no fee on expire)
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 5_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_expire_by_payer() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        clock.set_for_testing(DEADLINE_MS + 1);

        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 5_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineNotReached)]
    fun test_expire_before_deadline_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Clock is at 0, deadline is at 3,600,000 — can't expire yet
        scenario.next_tx(STRANGER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Protocol pause tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = admin::EProtocolPaused)]
    fun test_create_while_paused_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Fee edge cases
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_settle_with_max_fee() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // 1_000_000 micro-pct = 100% fee
        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 1_000_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_000, &clock, scenario.ctx());

        // 100% fee → fee_recipient gets 5M, recipient gets 0
        scenario.next_tx(FEE_RECIPIENT);
        let fee = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee.value() == 5_000_000);
        coin::burn_for_testing(fee);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_min_deposit() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Exact minimum deposit
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 5_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        // fee = 1_000_000 * 5_000 / 1_000_000 = 5_000
        scenario.next_tx(FEE_RECIPIENT);
        let fee = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee.value() == 5_000);
        coin::burn_for_testing(fee);

        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 995_000);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Deadline enforcement (settle must be before deadline)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineReached)]
    fun test_settle_after_deadline_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Advance clock past deadline — settle should now be blocked
        clock.set_for_testing(DEADLINE_MS);

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineReached)]
    fun test_settle_well_after_deadline_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Far past deadline — months later
        clock.set_for_testing(DEADLINE_MS + 100_000_000);

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_one_ms_before_deadline_succeeds() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Exactly 1ms before deadline — last valid moment to settle
        clock.set_for_testing(DEADLINE_MS - 1);

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 5_000_000, &clock, scenario.ctx());

        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 5_000_000);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Deadline boundary tests (BVA)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_expire_at_exact_deadline_succeeds() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Exactly at deadline — expire uses >= so this should work
        clock.set_for_testing(DEADLINE_MS);

        scenario.next_tx(PAYER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 5_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineNotReached)]
    fun test_expire_one_ms_before_deadline_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // 1ms before deadline — too early to expire
        clock.set_for_testing(DEADLINE_MS - 1);

        scenario.next_tx(STRANGER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = upto_deposit::EDeadlineInPast)]
    fun test_create_deadline_equals_now_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        clock.set_for_testing(1_000_000);

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // deadline == now_ms → fails (strict >)
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, 1_000_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Pause-safety invariant: exits always work while paused
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_settle_while_paused_succeeds() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Pause protocol — settle must still work (user exit)
        admin::pause(&cap, &mut state, &clock, scenario.ctx());

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 3_000_000, &clock, scenario.ctx());

        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 3_000_000);
        coin::burn_for_testing(received);

        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 2_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_expire_while_paused_succeeds() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(5_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Pause protocol + advance past deadline — expire must still work
        admin::pause(&cap, &mut state, &clock, scenario.ctx());
        clock.set_for_testing(DEADLINE_MS);

        scenario.next_tx(STRANGER);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::expire<SUI>(d, &clock, scenario.ctx());

        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 5_000_000);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Fee edge cases: boundaries and overflow protection
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_settle_actual_amount_one() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // actual_amount = 1 with 0.5% fee → fee truncates to 0
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 5_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1, &clock, scenario.ctx());

        // fee = 1 * 5000 / 1000000 = 0 (floor division)
        // recipient gets 1, payer gets 999,999 refund
        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 1);
        coin::burn_for_testing(received);

        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 999_999);
        coin::burn_for_testing(refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_fee_micro_pct_one() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // fee_micro_pct = 1 (0.0001%), actual = 1,000,000 → fee = 1
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 1, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, 1_000_000, &clock, scenario.ctx());

        // fee = 1_000_000 * 1 / 1_000_000 = 1
        scenario.next_tx(FEE_RECIPIENT);
        let fee = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee.value() == 1);
        coin::burn_for_testing(fee);

        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 999_999);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_settle_large_amount_overflow_protection() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // 10^18 (1 billion SUI) with 0.5% fee — tests u128 intermediate math
        let large: u64 = 1_000_000_000_000_000_000;
        let deposit = coin::mint_for_testing<SUI>(large, scenario.ctx());
        upto_deposit::create<SUI>(
            deposit, RECIPIENT, DEADLINE_MS, 5_000, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(RECIPIENT);
        let d = scenario.take_shared<upto_deposit::UptoDeposit<SUI>>();
        upto_deposit::settle<SUI>(d, large, &clock, scenario.ctx());

        // fee = 10^18 * 5000 / 10^6 = 5 * 10^15 = 5_000_000_000_000_000
        scenario.next_tx(FEE_RECIPIENT);
        let fee = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee.value() == 5_000_000_000_000_000);
        coin::burn_for_testing(fee);

        let received = scenario.take_from_address<coin::Coin<SUI>>(RECIPIENT);
        assert!(received.value() == 995_000_000_000_000_000);
        coin::burn_for_testing(received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
