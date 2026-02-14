#[test_only]
module sweepay::stream_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweepay::stream;
    use sweepay::admin;

    const PAYER: address = @0xCAFE;
    const PROVIDER: address = @0xBEEF;
    const FEE_RECIPIENT: address = @0xFEE;

    // Rate: 300 tokens/second ($0.0003/sec for USDC with 6 decimals)
    const RATE: u64 = 300;

    // ══════════════════════════════════════════════════════════════
    // Create tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_stream() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());

        stream::create<SUI>(
            deposit,
            PROVIDER,
            RATE,
            100_000,    // budget_cap = deposit
            50,         // 0.5% fee
            FEE_RECIPIENT,
            &state,
            &clock,
            scenario.ctx(),
        );

        // Verify meter was shared
        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        assert!(stream::meter_payer(&meter) == PAYER);
        assert!(stream::meter_recipient(&meter) == PROVIDER);
        assert!(stream::meter_balance(&meter) == 100_000);
        assert!(stream::meter_rate_per_second(&meter) == RATE);
        assert!(stream::meter_budget_cap(&meter) == 100_000);
        assert!(stream::meter_total_claimed(&meter) == 0);
        assert!(stream::meter_active(&meter) == true);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::EZeroDeposit)]
    fun test_create_zero_deposit_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(0, scenario.ctx());

        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::EZeroRate)]
    fun test_create_zero_rate_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());

        stream::create<SUI>(deposit, PROVIDER, 0, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Claim tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_claim_after_10_seconds() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Create stream: 100k tokens, 300/sec
        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds
        clock.increment_for_testing(10_000); // 10,000 ms

        // Provider claims
        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();

        // Check claimable before claim
        assert!(stream::claimable(&meter, &clock) == 3_000); // 300 * 10 = 3000

        stream::claim(&mut meter, &clock, scenario.ctx());

        assert!(stream::meter_total_claimed(&meter) == 3_000);
        assert!(stream::meter_balance(&meter) == 97_000); // 100k - 3k

        ts::return_shared(meter);

        // Verify provider received the funds
        scenario.next_tx(PROVIDER);
        let received = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(received.value() == 3_000);
        ts::return_to_address(PROVIDER, received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_with_fee() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 500, FEE_RECIPIENT, &state, &clock, scenario.ctx());
        // 500 bps = 5%

        // Advance 10 seconds → accrued = 3000
        clock.increment_for_testing(10_000);

        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::claim(&mut meter, &clock, scenario.ctx());

        // Fee: 3000 * 500 / 10000 = 150
        // Recipient: 3000 - 150 = 2850
        assert!(stream::meter_total_claimed(&meter) == 3_000);
        assert!(stream::meter_balance(&meter) == 97_000);

        ts::return_shared(meter);

        // Verify fee recipient got 150
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 150);
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        // Verify provider got 2850
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 2_850);
        ts::return_to_address(PROVIDER, provider_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_budget_cap_auto_deactivates() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Budget cap = 1500, rate = 300/sec → exhausted after 5 seconds
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 1_500, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds (double the budget)
        clock.increment_for_testing(10_000);

        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();

        // Should only be able to claim 1500 (budget cap), not 3000
        assert!(stream::claimable(&meter, &clock) == 1_500);

        stream::claim(&mut meter, &clock, scenario.ctx());

        assert!(stream::meter_total_claimed(&meter) == 1_500);
        assert!(stream::meter_active(&meter) == false); // auto-deactivated
        assert!(stream::meter_balance(&meter) == 8_500); // 10k - 1.5k

        ts::return_shared(meter);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_multiple_claims() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // First claim after 5 seconds
        clock.increment_for_testing(5_000);
        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 1_500); // 300 * 5

        // Second claim after another 3 seconds
        clock.increment_for_testing(3_000);
        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 2_400); // 1500 + 300*3

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ENotRecipient)]
    fun test_claim_wrong_sender_fails() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(5_000);

        // Payer tries to claim — should fail (only PROVIDER can claim)
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::claim(&mut meter, &clock, scenario.ctx());

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ENothingToClaim)]
    fun test_claim_zero_elapsed_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Immediately claim with zero elapsed time
        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::claim(&mut meter, &clock, scenario.ctx());

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Pause / Resume tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_pause_and_resume() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 5 seconds then pause
        clock.increment_for_testing(5_000);
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_active(&meter) == false);

        // Pre-pause accrual is now visible while paused (paused_at_ms fix)
        assert!(stream::claimable(&meter, &clock) == 1_500); // 300 * 5

        // Advance 10 more seconds — claimable stays at 1500 (no new accrual while paused)
        clock.increment_for_testing(10_000);
        assert!(stream::claimable(&meter, &clock) == 1_500); // still 300 * 5

        // Resume — pre-pause accrual is PRESERVED via time-shift
        scenario.next_tx(PAYER);
        stream::resume(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_active(&meter) == true);

        // Advance 5 seconds after resume
        clock.increment_for_testing(5_000);
        // 1500 (pre-pause, preserved) + 1500 (post-resume) = 3000
        assert!(stream::claimable(&meter, &clock) == 3_000);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_while_paused() {
        // CRITICAL fix test: recipient can claim pre-pause accrual while stream is paused
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → 3000 accrued
        clock.increment_for_testing(10_000);

        // Payer pauses
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_active(&meter) == false);

        // Pre-pause accrual should be visible
        assert!(stream::claimable(&meter, &clock) == 3_000);

        // Advance more time (doesn't increase claimable)
        clock.increment_for_testing(20_000);
        assert!(stream::claimable(&meter, &clock) == 3_000); // still 3000

        // Recipient claims while paused
        scenario.next_tx(PROVIDER);
        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 3_000);
        assert!(stream::meter_balance(&meter) == 97_000);

        ts::return_shared(meter);

        // Verify provider received the funds
        scenario.next_tx(PROVIDER);
        let received = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(received.value() == 3_000);
        ts::return_to_address(PROVIDER, received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ENothingToClaim)]
    fun test_double_claim_while_paused() {
        // CRITICAL fix test: after claiming pre-pause accrual, second claim fails
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → 3000 accrued
        clock.increment_for_testing(10_000);

        // Payer pauses
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Recipient claims pre-pause accrual
        scenario.next_tx(PROVIDER);
        stream::claim(&mut meter, &clock, scenario.ctx());

        // Now claimable should be 0 (paused_at_ms was reset to 0)
        assert!(stream::claimable(&meter, &clock) == 0);

        // Second claim should fail with ENothingToClaim
        stream::claim(&mut meter, &clock, scenario.ctx());

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_close_paused_with_accrual() {
        // CRITICAL fix test: close() on paused stream sends accrued funds to recipient
        // (Previously: close() skipped final claim when paused → stole funds)
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → 3000 accrued
        clock.increment_for_testing(10_000);

        // Payer pauses
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Advance more time (no additional accrual)
        clock.increment_for_testing(50_000);

        // Close while paused — should still send 3000 to provider
        scenario.next_tx(PAYER);
        stream::close(meter, &clock, scenario.ctx());

        // Verify provider got the pre-pause accrual
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 3_000);
        ts::return_to_address(PROVIDER, provider_coin);

        // Verify payer got refund of remaining balance
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 97_000); // 100k - 3k accrued
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ENotPayer)]
    fun test_pause_wrong_sender_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider tries to pause — should fail
        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_atomic_pause_resume_close_no_theft() {
        // SECURITY: Payer cannot atomically pause→resume→close to steal accrued funds.
        // Before the time-shift fix, this sequence erased the recipient's accrual.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → 3000 accrued by recipient
        clock.increment_for_testing(10_000);

        // Payer does pause → resume → close in rapid sequence (same clock tick)
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        stream::resume(&mut meter, &clock, scenario.ctx());
        stream::close(meter, &clock, scenario.ctx());

        // Recipient MUST still receive their 3000 accrued tokens
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 3_000);
        ts::return_to_address(PROVIDER, provider_coin);

        // Payer gets refund of remaining 97000
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 97_000);
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_resume_after_claim_while_paused_resets_cleanly() {
        // If recipient claims while paused, then payer resumes, the accrual
        // resets cleanly (no double-counting of already-claimed pre-pause funds).
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → 3000 accrued
        clock.increment_for_testing(10_000);

        // Payer pauses
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Recipient claims the pre-pause accrual
        scenario.next_tx(PROVIDER);
        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 3_000);

        // Advance 5 seconds while paused (no new accrual)
        clock.increment_for_testing(5_000);

        // Payer resumes — should reset cleanly since pre-pause was claimed
        scenario.next_tx(PAYER);
        stream::resume(&mut meter, &clock, scenario.ctx());

        // Advance 5 seconds after resume → 1500 new accrual only
        clock.increment_for_testing(5_000);
        assert!(stream::claimable(&meter, &clock) == 1_500); // fresh post-resume only

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_multiple_pause_resume_cycles_preserve_accrual() {
        // Multiple pause/resume cycles without claiming — accrual accumulates correctly.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Cycle 1: active 10s, then pause
        clock.increment_for_testing(10_000); // T=10000, 3000 accrued
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Wait 5s while paused (no accrual)
        clock.increment_for_testing(5_000); // T=15000

        // Resume — preserves the 3000 accrued in cycle 1
        scenario.next_tx(PAYER);
        stream::resume(&mut meter, &clock, scenario.ctx());

        // Cycle 2: active 10s, then pause
        clock.increment_for_testing(10_000); // T=25000, +3000 new = 6000 total
        scenario.next_tx(PAYER);
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Wait 20s while paused (no accrual)
        clock.increment_for_testing(20_000); // T=45000

        // Resume — preserves all 6000
        scenario.next_tx(PAYER);
        stream::resume(&mut meter, &clock, scenario.ctx());

        // Cycle 3: active 5s
        clock.increment_for_testing(5_000); // T=50000, +1500 new = 7500 total

        // Total accrual: 10s + 10s + 5s = 25 seconds of active time = 7500
        assert!(stream::claimable(&meter, &clock) == 7_500);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Close tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_close_with_final_claim_and_refund() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds → accrued 3000
        clock.increment_for_testing(10_000);

        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();

        // Close — should send 3000 to provider and refund 97000 to payer
        stream::close(meter, &clock, scenario.ctx());

        // Verify provider got final claim
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 3_000);
        ts::return_to_address(PROVIDER, provider_coin);

        // Verify payer got refund
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 97_000);
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_close_paused_stream_refunds_all() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Pause immediately
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());

        // Advance time (no accrual while paused)
        clock.increment_for_testing(100_000);

        // Close
        scenario.next_tx(PAYER);
        stream::close(meter, &clock, scenario.ctx());

        // Full refund to payer (nothing accrued while paused)
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 100_000);
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ENotPayer)]
    fun test_close_wrong_sender_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider tries to close — should fail
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Top up tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_top_up() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(50_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 200_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        assert!(stream::meter_balance(&meter) == 50_000);

        let extra = coin::mint_for_testing<SUI>(30_000, scenario.ctx());
        stream::top_up(&mut meter, extra, &state, &clock, scenario.ctx());
        assert!(stream::meter_balance(&meter) == 80_000);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Overflow protection tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_large_rate_no_overflow() {
        // High rate * long time should not overflow thanks to u128 intermediate
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let large_deposit: u64 = 1_000_000_000_000; // 10^12
        let deposit = coin::mint_for_testing<SUI>(large_deposit, scenario.ctx());

        // Rate: 10^9 tokens/second
        stream::create<SUI>(
            deposit, PROVIDER, 1_000_000_000, large_deposit, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx(),
        );

        // Advance 1000 seconds
        clock.increment_for_testing(1_000_000);

        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();

        // Expected: 10^9 * 1000 = 10^12 (matches deposit exactly)
        let expected = 1_000_000_000_000;
        assert!(stream::claimable(&meter, &clock) == expected);

        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == expected);
        assert!(stream::meter_active(&meter) == false); // budget exhausted

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Balance exhaustion test
    // ══════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════
    // Recipient close tests (abandoned stream recovery)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_recipient_close_paused_abandoned() {
        // Payer pauses and disappears. After 7+ days, recipient force-closes.
        // Accrued pre-pause funds go to recipient, remainder refunded to payer.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 5 seconds → 1500 accrued, then pause
        clock.increment_for_testing(5_000);
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        ts::return_shared(meter);

        // Advance 7 days + 1 second (past the timeout)
        clock.increment_for_testing(604_801_000);

        // Recipient force-closes the abandoned stream
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        // Verify recipient got the pre-pause accrual (1500)
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 1_500); // 300/sec * 5sec
        ts::return_to_address(PROVIDER, provider_coin);

        // Verify payer got refund of remaining balance
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 98_500); // 100k - 1500
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_recipient_close_active_abandoned() {
        // Payer creates stream and disappears without pausing.
        // After 7+ days with no interaction, recipient force-closes.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Low rate (1/sec) so balance isn't fully consumed over 7 days
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, 1, 1_000_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 7 days + 1 second (604,801,000 ms = 604,801 seconds)
        clock.increment_for_testing(604_801_000);

        // Recipient force-closes
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        // Accrued: 1 token/sec * 604,801 sec = 604,801
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 604_801);
        ts::return_to_address(PROVIDER, provider_coin);

        // Refund: 1,000,000 - 604,801 = 395,199
        scenario.next_tx(PAYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(refund.value() == 395_199);
        ts::return_to_address(PAYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ETimeoutNotReached)]
    fun test_recipient_close_before_timeout_fails() {
        // Recipient tries to force-close before 7 days — should fail.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 5 seconds, pause
        clock.increment_for_testing(5_000);
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        ts::return_shared(meter);

        // Advance 6 days (under the 7-day timeout)
        clock.increment_for_testing(518_400_000); // 6 days in ms

        // Recipient tries to force-close — should fail
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Balance exhaustion test
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_balance_exhausted_before_budget() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Deposit 1000 but budget 100000 — balance runs out first
        let deposit = coin::mint_for_testing<SUI>(1_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance enough to accrue more than balance (300/sec * 10sec = 3000 > 1000)
        clock.increment_for_testing(10_000);

        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();

        // Should be capped at balance (1000), not accrued (3000)
        assert!(stream::claimable(&meter, &clock) == 1_000);

        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 1_000);
        assert!(stream::meter_balance(&meter) == 0);
        assert!(stream::meter_active(&meter) == false); // balance exhausted

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Configurable timeout tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_with_custom_timeout() {
        // Create a stream with 2-day timeout instead of default 7 days
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        let two_days_ms: u64 = 2 * 24 * 60 * 60 * 1000; // 172_800_000

        stream::create_with_timeout<SUI>(
            deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT,
            two_days_ms, &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        assert!(stream::meter_payer(&meter) == PAYER);
        assert!(stream::meter_recipient(&meter) == PROVIDER);
        assert!(stream::meter_balance(&meter) == 100_000);
        // Verify the accessor returns the custom timeout
        assert!(stream::meter_recipient_close_timeout_ms(&meter) == two_days_ms);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_default_timeout_accessor() {
        // Streams created with create() should return the 7-day default
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        // Default 7-day timeout (604_800_000 ms)
        assert!(stream::meter_recipient_close_timeout_ms(&meter) == 604_800_000);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_recipient_close_custom_timeout() {
        // Create stream with 2-day timeout. Recipient can close after 2 days, not 7.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let two_days_ms: u64 = 172_800_000;

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create_with_timeout<SUI>(
            deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT,
            two_days_ms, &state, &clock, scenario.ctx(),
        );

        // Advance 10 seconds, then pause
        clock.increment_for_testing(10_000);
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        ts::return_shared(meter);

        // Advance 2 days + 1 second (past custom timeout, but BEFORE 7-day default)
        clock.increment_for_testing(two_days_ms + 1_000);

        // Recipient force-closes — should succeed with 2-day timeout
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ETimeoutNotReached)]
    fun test_recipient_close_custom_timeout_too_early() {
        // Create stream with 2-day timeout. Try to close after 1 day — should fail.
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let two_days_ms: u64 = 172_800_000;
        let one_day_ms: u64 = 86_400_000;

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create_with_timeout<SUI>(
            deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT,
            two_days_ms, &state, &clock, scenario.ctx(),
        );

        // Pause immediately, then advance 1 day (less than 2-day timeout)
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::pause(&mut meter, &clock, scenario.ctx());
        ts::return_shared(meter);

        clock.increment_for_testing(one_day_ms);

        // Recipient tries to close — should fail
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = stream::ETimeoutTooShort)]
    fun test_create_timeout_below_minimum_fails() {
        // Try to create a stream with a 1-hour timeout (below 1-day minimum)
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        let one_hour_ms: u64 = 3_600_000;

        stream::create_with_timeout<SUI>(
            deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT,
            one_hour_ms, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_payer_close_stream_with_custom_timeout() {
        // Payer close should work fine with streams that have custom timeout
        // (dynamic field cleanup before id.delete())
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let two_days_ms: u64 = 172_800_000;

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create_with_timeout<SUI>(
            deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT,
            two_days_ms, &state, &clock, scenario.ctx(),
        );

        // Advance 10 seconds, then payer closes
        clock.increment_for_testing(10_000);
        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Protocol pause tests (AdminCap integration)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_create_while_paused_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Try to create a stream — should fail
        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_top_up_while_paused_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Create stream first (while unpaused)
        let deposit = coin::mint_for_testing<SUI>(50_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 200_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Try to top up — should fail
        scenario.next_tx(PAYER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        let extra = coin::mint_for_testing<SUI>(30_000, scenario.ctx());
        stream::top_up(&mut meter, extra, &state, &clock, scenario.ctx());

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_while_protocol_paused_succeeds() {
        // User withdrawals must ALWAYS work, even when protocol is paused
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds
        clock.increment_for_testing(10_000);

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Recipient should still be able to claim (withdrawal always allowed)
        scenario.next_tx(PROVIDER);
        let mut meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::claim(&mut meter, &clock, scenario.ctx());
        assert!(stream::meter_total_claimed(&meter) == 3_000);

        ts::return_shared(meter);
        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_close_while_protocol_paused_succeeds() {
        // Payer close (withdrawal) must ALWAYS work, even when protocol is paused
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, RATE, 100_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(10_000);

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Payer should still be able to close (withdrawal always allowed)
        scenario.next_tx(PAYER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_recipient_close_while_protocol_paused_succeeds() {
        // Recipient close (withdrawal) must ALWAYS work, even when protocol is paused
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        stream::create<SUI>(deposit, PROVIDER, 1, 1_000_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 7 days + 1 second
        clock.increment_for_testing(604_801_000);

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Recipient should still be able to force-close (withdrawal always allowed)
        scenario.next_tx(PROVIDER);
        let meter = scenario.take_shared<stream::StreamingMeter<SUI>>();
        stream::recipient_close(meter, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
