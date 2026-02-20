#[test_only]
module sweefi::prepaid_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweefi::prepaid;
    use sweefi::admin;

    const AGENT: address = @0xA1;
    const PROVIDER: address = @0xBEEF;
    const FEE_RECIPIENT: address = @0xFEE;

    // Rate: 1000 base-units per call (e.g., 0.001 USDC)
    const RATE: u64 = 1_000;
    // Default withdrawal delay: 30 minutes
    const DELAY_MS: u64 = 1_800_000;
    // u64::MAX for unlimited calls
    const UNLIMITED: u64 = 18_446_744_073_709_551_615;

    // ══════════════════════════════════════════════════════════════
    // Deposit tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_deposit_creates_balance() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(
            deposit,
            PROVIDER,
            RATE,
            UNLIMITED,
            DELAY_MS,
            50,             // 0.5% fee
            FEE_RECIPIENT,
            &state,
            &clock,
            scenario.ctx(),
        );

        // Verify balance was shared
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_agent(&bal) == AGENT);
        assert!(prepaid::balance_provider(&bal) == PROVIDER);
        assert!(prepaid::balance_remaining(&bal) == 1_000_000);
        assert!(prepaid::balance_rate_per_call(&bal) == RATE);
        assert!(prepaid::balance_max_calls(&bal) == UNLIMITED);
        assert!(prepaid::balance_claimed_calls(&bal) == 0);
        assert!(prepaid::balance_withdrawal_pending(&bal) == false);
        assert!(prepaid::balance_fee_bps(&bal) == 50);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EZeroDeposit)]
    fun test_deposit_zero_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(0, scenario.ctx());

        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EZeroRate)]
    fun test_deposit_zero_rate_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        prepaid::deposit<SUI>(deposit, PROVIDER, 0, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidFeeBps)]
    fun test_deposit_invalid_fee_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 10_001, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalDelayTooShort)]
    fun test_deposit_short_delay_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // 30 seconds — below 60 second minimum
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, 30_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalDelayTooLong)]
    fun test_deposit_excessive_delay_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // 8 days — above 7 day cap
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, 691_200_000, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Claim tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_claim_basic() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Deposit 1M tokens, rate 1000/call
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);

        // Provider claims 100 calls → 100 * 1000 = 100,000
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        assert!(prepaid::balance_claimed_calls(&bal) == 100);
        assert!(prepaid::balance_remaining(&bal) == 900_000); // 1M - 100K

        ts::return_shared(bal);

        // Verify provider received funds
        scenario.next_tx(PROVIDER);
        let received = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(received.value() == 100_000);
        ts::return_to_address(PROVIDER, received);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_cumulative() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // First claim: 500 calls
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 500, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 500);
        assert!(prepaid::balance_remaining(&bal) == 500_000); // 1M - 500K

        // Second claim: 800 total (delta = 300)
        clock.increment_for_testing(1_000);
        prepaid::claim(&mut bal, 800, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 800);
        assert!(prepaid::balance_remaining(&bal) == 200_000); // 500K - 300K

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_same_count_is_noop() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Claim 100 calls
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        let last_claim_after_first = prepaid::balance_last_claim_ms(&bal);

        // Advance time and re-claim with same count — should be no-op
        clock.increment_for_testing(5_000);
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        // last_claim_ms should NOT have been updated (zero-delta griefing prevention)
        assert!(prepaid::balance_last_claim_ms(&bal) == last_claim_after_first);
        assert!(prepaid::balance_remaining(&bal) == 900_000); // unchanged

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ECallCountRegression)]
    fun test_claim_regression_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Claim 500 calls
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 500, &clock, scenario.ctx());

        // Try to claim 400 (regression) — should abort
        prepaid::claim(&mut bal, 400, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EMaxCallsExceeded)]
    fun test_claim_max_calls_exceeded() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // max_calls = 1000
        let deposit = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, 1_000, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Try to claim 1001 calls — exceeds max_calls of 1000
        prepaid::claim(&mut bal, 1_001, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ERateLimitExceeded)]
    fun test_claim_rate_limit_exceeded() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Only 100K deposited, rate=1000/call, so max ~100 calls
        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Try to claim 200 calls → 200,000 > 100,000 balance
        prepaid::claim(&mut bal, 200, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ENotProvider)]
    fun test_claim_not_provider_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);

        // Agent tries to claim (not the provider) — should fail
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_with_fee_split() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // 500 bps = 5% fee
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 500, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Claim 100 calls → gross = 100,000
        // Fee: 100,000 * 500 / 10,000 = 5,000
        // Provider gets: 100,000 - 5,000 = 95,000
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        assert!(prepaid::balance_remaining(&bal) == 900_000); // 1M - 100K gross

        ts::return_shared(bal);

        // Verify fee recipient got 5,000
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 5_000);
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        // Verify provider got 95,000
        scenario.next_tx(PROVIDER);
        let provider_coin = scenario.take_from_address<coin::Coin<SUI>>(PROVIDER);
        assert!(provider_coin.value() == 95_000);
        ts::return_to_address(PROVIDER, provider_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_updates_last_claim_ms() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Advance 10 seconds
        clock.increment_for_testing(10_000);

        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());

        // last_claim_ms should be updated to current time (10000)
        assert!(prepaid::balance_last_claim_ms(&bal) == 10_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_allowed_during_withdrawal() {
        // Claims succeed during pending withdrawal — the grace period IS
        // the provider's window to submit final claims
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);

        // Agent requests withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_withdrawal_pending(&bal) == true);

        // Provider can still claim during the grace period
        scenario.next_tx(PROVIDER);
        prepaid::claim(&mut bal, 200, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 200);
        assert!(prepaid::balance_remaining(&bal) == 800_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_claim_overflow_safety() {
        // Large rate * large count should use u128 correctly
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let large_deposit: u64 = 10_000_000_000; // 10B
        let large_rate: u64 = 1_000_000_000;     // 1B per call
        let deposit = coin::mint_for_testing<SUI>(large_deposit, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, large_rate, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // 10 calls at 1B/call = 10B (exactly matches deposit)
        prepaid::claim(&mut bal, 10, &clock, scenario.ctx());
        assert!(prepaid::balance_remaining(&bal) == 0);
        assert!(prepaid::balance_claimed_calls(&bal) == 10);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Withdrawal tests (two-phase)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_request_withdrawal() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(5_000);

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        assert!(prepaid::balance_withdrawal_pending(&bal) == true);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_finalize_withdrawal_after_delay() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Request withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Advance past delay (30 min = 1,800,000 ms)
        clock.increment_for_testing(DELAY_MS + 1_000);

        // Finalize
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_withdrawal(bal, &clock, scenario.ctx());

        // Verify agent received refund
        scenario.next_tx(AGENT);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(AGENT);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(AGENT, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalLocked)]
    fun test_finalize_withdrawal_before_delay_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Request withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Only advance 10 seconds (way before 30 min delay)
        clock.increment_for_testing(10_000);

        // Try to finalize — should fail
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_withdrawal(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_cancel_withdrawal() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Request withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_withdrawal_pending(&bal) == true);

        // Cancel
        prepaid::cancel_withdrawal(&mut bal, scenario.ctx());
        assert!(prepaid::balance_withdrawal_pending(&bal) == false);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ENotAgent)]
    fun test_withdraw_not_agent_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider tries to request withdrawal — should fail
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_zero_delta_claim_no_lock_extension() {
        // Provider spams claim(same_count) — must NOT extend the withdrawal lock
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Claim 100 calls at T=1000
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        let claim_time = prepaid::balance_last_claim_ms(&bal);

        // Agent requests withdrawal at T=2000
        clock.increment_for_testing(1_000);
        scenario.next_tx(AGENT);
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        // Provider spams zero-delta claim at T=1,800,000 (just before delay expires)
        clock.increment_for_testing(DELAY_MS - 2_000);
        scenario.next_tx(PROVIDER);
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx()); // same count = no-op

        // last_claim_ms should still be from the real claim, not the no-op
        assert!(prepaid::balance_last_claim_ms(&bal) == claim_time);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Top-up & Close tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_top_up() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(500_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_remaining(&bal) == 500_000);

        let extra = coin::mint_for_testing<SUI>(300_000, scenario.ctx());
        prepaid::top_up(&mut bal, extra, &state, &clock, scenario.ctx());
        assert!(prepaid::balance_remaining(&bal) == 800_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalPending)]
    fun test_top_up_blocked_during_withdrawal() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(500_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        // Top-up while withdrawal pending — should fail
        let extra = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        prepaid::top_up(&mut bal, extra, &state, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_agent_close_exhausted() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        // Deposit exactly enough for 100 calls
        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider claims all 100 calls
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_remaining(&bal) == 0);
        ts::return_shared(bal);

        // Agent closes the exhausted balance
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::agent_close(bal, &clock, scenario.ctx());

        // Object is now destructured — no shared object to take
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_provider_close_fully_claimed() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(100_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider claims everything
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Provider closes
        scenario.next_tx(PROVIDER);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::provider_close(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Authorization & exhaustion guard tests (PR review L-01/L-02/L-03)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalPending)]
    fun test_double_request_withdrawal_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        // Second request — should fail with EWithdrawalPending
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ENotAgent)]
    fun test_cancel_withdrawal_not_agent_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());

        // Provider tries to cancel — should fail
        scenario.next_tx(PROVIDER);
        prepaid::cancel_withdrawal(&mut bal, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ENotAgent)]
    fun test_finalize_withdrawal_not_agent_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        clock.increment_for_testing(DELAY_MS + 1_000);

        // Provider tries to finalize — should fail
        scenario.next_tx(PROVIDER);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_withdrawal(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EBalanceNotExhausted)]
    fun test_close_with_remaining_balance_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Try to close with funds still remaining — should fail
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::agent_close(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Edge cases
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_agent_equals_provider() {
        // Same address as agent and provider (self-service use case)
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, AGENT, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Agent is also the provider — can claim
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 100);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_deposit_max_calls_unlimited() {
        // u64::MAX as max_calls works correctly
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_max_calls(&bal) == UNLIMITED);

        // Can claim a large number without hitting max_calls
        clock.increment_for_testing(1_000);
        prepaid::claim(&mut bal, 500, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 500);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Admin pause tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = admin::EAlreadyPaused)]
    fun test_protocol_paused_blocks_deposit() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        admin::pause(&cap, &mut state, scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_protocol_paused_allows_claim() {
        // Provider can always claim — no pause guard on claims
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Provider should still be able to claim
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 100);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_protocol_paused_allows_withdrawal() {
        // Agent can always exit — no pause guard on withdrawal
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Agent should still be able to request withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        // And finalize after delay
        clock.increment_for_testing(DELAY_MS + 1_000);
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_withdrawal(bal, &clock, scenario.ctx());

        // Verify agent got refund
        scenario.next_tx(AGENT);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(AGENT);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(AGENT, refund);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
