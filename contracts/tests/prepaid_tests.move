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
            5_000,          // 0.5% fee
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
        assert!(prepaid::balance_fee_micro_pct(&bal) == 5_000);

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
    #[expected_failure(abort_code = prepaid::EZeroRate)]
    fun test_deposit_zero_max_calls_fails() {
        // T-6: max_calls = 0 creates an unclaimable PrepaidBalance (L-3 fix).
        //
        // Before the fix: deposit(max_calls=0) succeeded, creating a balance where the
        // provider could NEVER claim. claim() checks cumulative_call_count <= max_calls,
        // so any call count > 0 would fail with EMaxCallsExceeded. Agent's funds would be
        // locked with no path to recovery other than the two-phase withdrawal.
        //
        // The fix adds: assert!(max_calls > 0, EZeroRate) to both deposit() and
        // deposit_with_receipts(). Use u64::MAX (UNLIMITED) for uncapped call balances.
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // max_calls = 0 → provider can never claim → deposit should be rejected
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, 0, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidFeeMicroPct)]
    fun test_deposit_invalid_fee_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 1_000_001, FEE_RECIPIENT, &state, &clock, scenario.ctx());

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

        // Deposit 1M, rate=1000/call → max 1000 calls; claim 1100 to exceed
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Try to claim 1100 calls → 1_100_000 > 1_000_000 balance
        prepaid::claim(&mut bal, 1100, &clock, scenario.ctx());

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

        // 50_000 fee_micro_pct = 5% fee
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 50_000, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();

        // Claim 100 calls → gross = 100,000
        // Fee: 100,000 * 50_000 / 1_000_000 = 5,000
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

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_remaining(&bal) == 1_000_000);

        let extra = coin::mint_for_testing<SUI>(300_000, scenario.ctx());
        prepaid::top_up(&mut bal, extra, &state, &clock, scenario.ctx());
        assert!(prepaid::balance_remaining(&bal) == 1_300_000);

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

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
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

        // Deposit exactly enough for 1000 calls (RATE=1000, 1000 calls = 1_000_000)
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider claims all 1000 calls
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 1000, &clock, scenario.ctx());
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

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT, &state, &clock, scenario.ctx());

        // Provider claims everything (RATE=1000, 1000 calls = 1_000_000)
        clock.increment_for_testing(1_000);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 1000, &clock, scenario.ctx());
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

    // ══════════════════════════════════════════════════════════════
    // v0.2 Signed Receipt / Fraud Proof Tests
    // ══════════════════════════════════════════════════════════════

    // Test vectors generated by scripts/generate-test-vectors.mjs
    // Balance ID = @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed
    // (deterministic ID from test_scenario for AGENT @0xA1's first shared object)
    //
    // Provider Ed25519 public key (32 bytes)
    const TEST_PUBKEY: vector<u8> = vector[0x95, 0x48, 0xa4, 0x0f, 0xe4, 0x73, 0x3b, 0xba, 0xe9, 0x3b, 0xcc, 0x90, 0x6e, 0x38, 0xbd, 0x67, 0x05, 0xc3, 0xfa, 0xa2, 0x30, 0x9b, 0x42, 0xf2, 0xb0, 0x88, 0x77, 0x89, 0x34, 0x9b, 0xb7, 0x38];
    // Signature for call #50, balance @0x06d5...c8ed, ts=1700000000000, hash=0xdeadbeef...
    const TEST_SIG_CALL_50: vector<u8> = vector[0x37, 0x4c, 0xa2, 0xd2, 0xaa, 0x6e, 0x99, 0xc1, 0x87, 0xa9, 0xc8, 0x2f, 0x06, 0x1c, 0xb1, 0xc4, 0xa0, 0x29, 0xff, 0x44, 0xe5, 0x15, 0xc5, 0x63, 0x4c, 0x8c, 0x10, 0xc7, 0x2e, 0xb4, 0x81, 0x63, 0x96, 0x3f, 0xb4, 0x4e, 0xe9, 0x66, 0x79, 0xac, 0x7a, 0x03, 0x64, 0x91, 0x4c, 0x78, 0xf4, 0x43, 0xd3, 0x81, 0x3b, 0x9a, 0xc6, 0x74, 0x3e, 0x9e, 0x7f, 0x0f, 0xb7, 0xed, 0xb7, 0x78, 0x78, 0x04];
    // Signature for call #99 (boundary test)
    const TEST_SIG_CALL_99: vector<u8> = vector[0x64, 0x9d, 0x05, 0x3a, 0x9e, 0x8b, 0xf0, 0x22, 0xe2, 0xb6, 0xaa, 0x10, 0x87, 0x69, 0xb3, 0x8b, 0xd7, 0x4a, 0xae, 0xbd, 0x96, 0xc9, 0x4f, 0xb4, 0x40, 0x9d, 0x0a, 0x68, 0x39, 0xbb, 0x9c, 0xdd, 0x61, 0xce, 0xd4, 0xe8, 0x8f, 0xe7, 0xe9, 0xcf, 0x03, 0xed, 0xdb, 0x41, 0x25, 0x03, 0x61, 0xd1, 0x08, 0x22, 0x5d, 0xc4, 0x28, 0x45, 0x09, 0x61, 0x5d, 0x83, 0x56, 0xf6, 0xb3, 0xe5, 0x20, 0x0c];
    // Signature for wrong balance ID (@0x99)
    const TEST_SIG_WRONG_ID: vector<u8> = vector[0xd1, 0x57, 0x6d, 0xb0, 0xb0, 0x44, 0x6f, 0xa7, 0xd8, 0xc9, 0x0e, 0x08, 0xb5, 0x46, 0x98, 0x16, 0xf0, 0x9a, 0x92, 0x40, 0xe2, 0x9a, 0x60, 0x2f, 0x25, 0x62, 0x3c, 0xd4, 0x1d, 0x26, 0x7c, 0x28, 0x79, 0xa6, 0xae, 0xa9, 0x43, 0x2d, 0xa9, 0x89, 0xb9, 0xa5, 0x3c, 0xc3, 0xcf, 0xd8, 0x39, 0x61, 0x11, 0x9f, 0xff, 0x41, 0xf9, 0xff, 0x1f, 0xf7, 0xc8, 0xa3, 0xaa, 0x3d, 0x89, 0x83, 0xbc, 0x0f];
    const TEST_RESPONSE_HASH: vector<u8> = vector[0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef];
    // Dispute window: 5 minutes
    const DISPUTE_WINDOW_MS: u64 = 300_000;

    // ── Helper: create v0.2 balance with receipts ──

    /// Creates a v0.2 PrepaidBalance and returns the scenario with a shared balance.
    /// The test_scenario ObjectID for the first shared object created by AGENT is
    /// deterministic, so we can predict the balance_id for fraud proof tests.
    fun setup_v2_balance(scenario: &mut ts::Scenario, clock: &clock::Clock, state: &admin::ProtocolState) {
        let deposit = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        prepaid::deposit_with_receipts<SUI>(
            deposit,
            PROVIDER,
            RATE,
            UNLIMITED,
            DELAY_MS,
            5_000,          // 0.5% fee
            FEE_RECIPIENT,
            TEST_PUBKEY,
            DISPUTE_WINDOW_MS,
            state,
            clock,
            scenario.ctx(),
        );
    }

    // ── deposit_with_receipts tests ──

    #[test]
    fun test_deposit_with_receipts_creates_v2_balance() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_remaining(&bal) == 10_000_000);
        assert!(prepaid::balance_dispute_window_ms(&bal) == DISPUTE_WINDOW_MS);
        assert!(prepaid::balance_disputed(&bal) == false);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        let expected_pubkey = TEST_PUBKEY;
        assert!(prepaid::balance_provider_pubkey(&bal) == &expected_pubkey);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidProviderPubkey)]
    fun test_deposit_with_receipts_bad_pubkey_length() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        let bad_pubkey = vector[0x01, 0x02, 0x03]; // Too short
        prepaid::deposit_with_receipts<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT,
            bad_pubkey, DISPUTE_WINDOW_MS, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidDisputeWindow)]
    fun test_deposit_with_receipts_window_too_short() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit_with_receipts<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT,
            TEST_PUBKEY, 1_000, // 1 second — below 60s minimum
            &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidDisputeWindow)]
    fun test_deposit_with_receipts_window_too_long() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit_with_receipts<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT,
            TEST_PUBKEY, 100_000_000, // ~27.7 hours — above 24h max
            &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── Optimistic claim tests ──

    #[test]
    fun test_v2_claim_creates_pending() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 calls
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        // Verify pending state (NOT transferred yet)
        assert!(prepaid::balance_pending_claim_count(&bal) == 100);
        assert!(prepaid::balance_remaining(&bal) == 10_000_000); // Funds still in balance
        assert!(prepaid::balance_claimed_calls(&bal) == 0); // NOT updated yet

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EPendingClaimExists)]
    fun test_v2_double_pending_claim_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // First claim → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());

        // Second claim → should fail (pending exists)
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // NOTE: test_v2_claim_on_disputed_fails is not included here because
    // setting disputed=true requires a valid Ed25519 fraud proof, which needs
    // the balance's object ID at test time. The EBalanceDisputed guard on claim()
    // is verified indirectly via the dispute integration test below.

    // ── finalize_claim tests ──

    #[test]
    fun test_v2_finalize_claim_after_window() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 calls
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Advance past dispute window
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1_000);

        // Anyone can finalize (permissionless)
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());

        // Verify: funds transferred, state updated
        assert!(prepaid::balance_claimed_calls(&bal) == 100);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        // 100 calls * 1000 rate = 100_000 gross. 0.5% fee = 500. Provider gets 99,500.
        assert!(prepaid::balance_remaining(&bal) == 10_000_000 - 100_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::EClaimNotFinalizable)]
    fun test_v2_finalize_claim_before_window_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Try to finalize immediately (window hasn't elapsed)
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = prepaid::ENoPendingClaim)]
    fun test_v2_finalize_claim_no_pending_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Try to finalize without any pending claim
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── withdraw_disputed tests ──

    #[test]
    #[expected_failure(abort_code = prepaid::EBalanceNotDisputed)]
    fun test_withdraw_disputed_not_disputed_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Try to withdraw_disputed on a non-disputed balance
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::withdraw_disputed(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── Close guards for v0.2 ──

    // NOTE: agent_close/provider_close with pending claim test:
    // In v0.2, a pending claim doesn't move funds, so balance > 0 when a claim
    // is pending. agent_close checks deposited == 0 first (EBalanceNotExhausted),
    // which fires before EPendingClaimExists. The pending claim guard on close
    // functions is defense-in-depth for when a finalized claim drains balance to
    // exactly zero but another claim was somehow queued (impossible in practice
    // since only one pending claim allowed). The guard is tested via finalize_withdrawal.

    // ── Finalize withdrawal with pending claim guard ──

    #[test]
    #[expected_failure(abort_code = prepaid::EPendingClaimExists)]
    fun test_v2_finalize_withdrawal_with_pending_claim_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Agent requests withdrawal
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Provider claims during grace period → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Wait for withdrawal delay
        clock.increment_for_testing(DELAY_MS + 1_000);

        // Agent tries to finalize withdrawal (should fail — claim is pending)
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_withdrawal(bal, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── v0.1 backward compatibility ──

    #[test]
    fun test_v1_deposit_has_zero_dispute_window() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT,
            &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_dispute_window_ms(&bal) == 0);
        assert!(prepaid::balance_disputed(&bal) == false);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_v1_claim_still_immediate() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 5_000, FEE_RECIPIENT,
            &state, &clock, scenario.ctx(),
        );

        // Provider claims 100 calls — should be immediate (no pending)
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());

        // Verify: immediate settlement (no pending state)
        assert!(prepaid::balance_claimed_calls(&bal) == 100);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        assert!(prepaid::balance_remaining(&bal) == 1_000_000 - 100_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── Integration: happy path (deposit → claim → finalize) ──

    #[test]
    fun test_v2_happy_path_deposit_claim_finalize() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 200 calls
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 200, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 200);
        ts::return_shared(bal);

        // Wait for dispute window to elapse
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);

        // Finalize (permissionless)
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());

        // State updated
        assert!(prepaid::balance_claimed_calls(&bal) == 200);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        // 200 * 1000 = 200_000 gross. 0.5% fee = 1000.
        assert!(prepaid::balance_remaining(&bal) == 10_000_000 - 200_000);
        ts::return_shared(bal);

        // Provider can claim again
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 300, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 300);
        ts::return_shared(bal);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── Fraud proof / dispute integration tests ──────────────────────────────
    //
    // Test vectors (from scripts/generate-test-vectors.mjs):
    //   balance_id = @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed  (the deterministic ID for setup_v2_balance's first object)
    //   call_number = 50   → TEST_SIG_CALL_50
    //   call_number = 99   → TEST_SIG_CALL_99
    //   wrong balance @0x99 → TEST_SIG_WRONG_ID
    //   timestamp = 1700000000000, hash = TEST_RESPONSE_HASH
    //
    // If a test aborts at the balance_id assertion (code 0), re-run
    // generate-test-vectors.mjs with the actual object ID and regenerate
    // the constant vectors above.
    // ────────────────────────────────────────────────────────────────────────

    // Test 1 (F2 — positive): dispute_claim succeeds with a valid fraud proof.
    // Provider claims 100 calls; agent submits receipt #50 (signed for @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed).
    // After F1 fix: receipt_call_number(50) must satisfy:
    //   50 > claimed_calls(0) ✓  AND  50 < pending_claim_count(100) ✓
    #[test]
    fun test_v2_dispute_claim_succeeds() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 calls → enters pending state
        // NOTE: if this test aborts at EInvalidFraudProof (and not at the
        // expected_failure annotation), the actual balance object ID differs from
        // @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed. Re-run scripts/generate-test-vectors.mjs with the correct ID.
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 100);
        ts::return_shared(bal);

        // Agent disputes within the 5-minute dispute window (clock still at 0ms)
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,                 // receipt_balance_id (must match balance's object ID)
            50,                    // receipt_call_number: 50 < 100 and 50 > 0 ✓
            1700000000000,         // receipt_timestamp_ms (from vector generation)
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );

        // Fraud proven: balance frozen, pending state cleared, no funds moved
        assert!(prepaid::balance_disputed(&bal) == true);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        assert!(prepaid::balance_remaining(&bal) == 10_000_000); // funds still locked
        assert!(prepaid::balance_claimed_calls(&bal) == 0);      // nothing settled

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Test 2 (F2 — positive): full flow: claim → dispute → withdraw_disputed.
    // After a successful dispute, the agent recovers the full balance immediately.
    #[test]
    fun test_v2_withdraw_disputed_after_fraud_proof() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 calls → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Agent disputes with receipt #50
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );
        assert!(prepaid::balance_disputed(&bal) == true);
        ts::return_shared(bal);

        // Agent withdraws immediately (no delay — trust is broken)
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::withdraw_disputed(bal, &clock, scenario.ctx());

        // Verify agent received the full 10M deposit back
        scenario.next_tx(AGENT);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(AGENT);
        assert!(refund.value() == 10_000_000);
        ts::return_to_address(AGENT, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Test 3 (F2 — negative): dispute fails when receipt_call_number >= pending_claim_count.
    // Provider claims 50; agent submits receipt #99 (99 >= 50 → wrong direction).
    // Verifies upper-bound guard: receipt must be LESS than the pending count.
    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidFraudProof)]
    fun test_v2_dispute_wrong_direction_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims only 50 calls
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Agent submits receipt #99 — but 99 >= 50 (pending), so 99 < 50 is FALSE
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            99,                // receipt_call_number=99 >= pending_claim_count=50 → EInvalidFraudProof
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_99,
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Test 4 (F2 — negative): dispute fails when signature doesn't match the balance.
    // TEST_SIG_WRONG_ID was signed over a message with balance_id=@0x99, not @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed.
    // Passing receipt_balance_id=@0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed passes the ID check but fails sig verification.
    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidFraudProof)]
    fun test_v2_dispute_wrong_signature_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        // Correct balance_id (@0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed), correct direction (50 < 100), BUT wrong sig
        // (TEST_SIG_WRONG_ID was signed over message with balance_id=@0x99)
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_WRONG_ID,  // signature for @0x99 — won't verify for @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Test 5 (F2 — negative): dispute fails after finalize_claim has already run.
    // Once finalized, pending_claim_count resets to 0 → ENoPendingClaim.
    #[test]
    #[expected_failure(abort_code = prepaid::ENoPendingClaim)]
    fun test_v2_dispute_after_finalize_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Advance past the 5-minute dispute window and finalize
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1_000);
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        assert!(prepaid::balance_claimed_calls(&bal) == 100);
        ts::return_shared(bal);

        // Agent tries to dispute — but pending_claim_count is now 0 → ENoPendingClaim
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ── Zero-delta no-op on v0.2 balance ──

    #[test]
    fun test_v2_zero_delta_claim_is_noop() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Finalize the claim
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());

        // Zero-delta claim (same count) — should be no-op
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 0); // No new pending

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // v0.2 Security Fix Verification Tests
    // ══════════════════════════════════════════════════════════════

    // F1 verification: Receipt from a settled (finalized) batch MUST NOT be usable
    // to dispute a future pending claim. Without the lower bound check at line 609,
    // an agent could reuse old receipt #50 after claimed_calls has moved past 50.
    #[test]
    #[expected_failure(abort_code = prepaid::EInvalidFraudProof)]
    fun test_v2_dispute_with_settled_batch_receipt_fails() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 50 calls → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Finalize → claimed_calls = 50 (batch settled)
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 50);
        ts::return_shared(bal);

        // Provider claims more → pending_claim_count = 100
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 100);
        ts::return_shared(bal);

        // Agent tries to dispute with receipt #50 from the SETTLED batch.
        // F1 check: 50 > claimed_calls(50) → FALSE → EInvalidFraudProof
        // (The bounds check aborts before signature verification is reached.)
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,                    // receipt from settled batch (call #50 <= claimed_calls 50)
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // F4 verification: withdrawal_delay_ms MUST be >= dispute_window_ms.
    // Without this, a provider can submit a claim that can't be disputed before
    // the agent's withdrawal delay expires — a griefing/safety foot-gun.
    #[test]
    #[expected_failure(abort_code = prepaid::EWithdrawalDelayTooShort)]
    fun test_deposit_with_receipts_delay_less_than_window_fails() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::deposit_with_receipts<SUI>(
            deposit,
            PROVIDER,
            RATE,
            UNLIMITED,
            120_000,        // withdrawal_delay: 2 minutes (>= 60s min ✓)
            0,
            FEE_RECIPIENT,
            TEST_PUBKEY,
            300_000,        // dispute_window: 5 minutes (within 1min–24h ✓)
            &state,         // BUT: 120_000 < 300_000 → F4 triggers
            &clock,
            scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // v0.2 Extended Dispute Path Tests
    // ══════════════════════════════════════════════════════════════

    // Valid receipt after partial settlement: provider settled calls 1-50,
    // then claims cumulative 150. Agent's receipt #99 proves fraud:
    //   99 > claimed_calls(50) ✓  AND  99 < pending_claim_count(150) ✓
    // Uses existing TEST_SIG_CALL_99 (signed for this balance ID).
    #[test]
    fun test_v2_dispute_with_valid_receipt_after_settlement() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Round 1: Provider claims 50 calls, finalize → claimed_calls=50
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 50, &clock, scenario.ctx());
        ts::return_shared(bal);

        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 50);
        ts::return_shared(bal);

        // Round 2: Provider claims 150 cumulative → pending_claim_count=150
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 150, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 150);
        ts::return_shared(bal);

        // Agent disputes with receipt #99: 99 > 50 ✓ AND 99 < 150 ✓
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            99,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_99,
            &clock,
            scenario.ctx(),
        );

        // Fraud proven — balance frozen
        assert!(prepaid::balance_disputed(&bal) == true);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        // 50 calls were settled (50 * 1000 = 50K gross, minus 0.5% fee = 250)
        // Remaining = 10M - 50K + 250 fee (no, fee is taken from gross)
        // Actually: 50 * 1000 = 50,000 gross. 0.5% fee = 250. Provider got 49,750. Fee recipient got 250.
        // Balance remaining = 10M - 50,000 = 9,950,000
        assert!(prepaid::balance_remaining(&bal) == 9_950_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Multiple claim-finalize cycles: two rounds of claim → finalize.
    // Verifies claimed_calls increments correctly through both cycles.
    #[test]
    fun test_v2_multiple_claim_finalize_cycles() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // ── Cycle 1: claims 200 calls ──
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 200, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 200);
        ts::return_shared(bal);

        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 200);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        // 200 * 1000 = 200,000 gross; 0.5% fee = 1,000
        assert!(prepaid::balance_remaining(&bal) == 10_000_000 - 200_000);
        ts::return_shared(bal);

        // ── Cycle 2: claims 400 cumulative (200 new) ──
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 400, &clock, scenario.ctx());
        assert!(prepaid::balance_pending_claim_count(&bal) == 400);
        ts::return_shared(bal);

        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);
        scenario.next_tx(@0xCA11);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::finalize_claim(&mut bal, &clock, scenario.ctx());
        assert!(prepaid::balance_claimed_calls(&bal) == 400);
        assert!(prepaid::balance_pending_claim_count(&bal) == 0);
        // 400 total * 1000 = 400,000 gross total
        assert!(prepaid::balance_remaining(&bal) == 10_000_000 - 400_000);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Dispute after window expires: provider claims, clock advances past
    // dispute_window_ms, agent tries to dispute → EDisputeWindowExpired.
    #[test]
    #[expected_failure(abort_code = prepaid::EDisputeWindowExpired)]
    fun test_v2_dispute_window_expired() {
        let mut scenario = ts::begin(AGENT);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Advance past dispute window
        clock.increment_for_testing(DISPUTE_WINDOW_MS + 1);

        // Agent tries to dispute — too late
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // Withdraw disputed after requesting normal withdrawal: verifies that
    // withdraw_disputed works even if the agent previously called
    // request_withdrawal (the normal path). Trust is broken — agent should
    // always be able to recover via the fraud-proof path.
    #[test]
    fun test_v2_withdraw_disputed_after_normal_withdrawal_request() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Agent requests normal withdrawal first
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::request_withdrawal(&mut bal, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Provider claims 100 → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Agent disputes with receipt #50
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );
        assert!(prepaid::balance_disputed(&bal) == true);
        ts::return_shared(bal);

        // Agent uses withdraw_disputed — works despite pending normal withdrawal
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::withdraw_disputed(bal, &clock, scenario.ctx());

        // Verify agent got full refund
        scenario.next_tx(AGENT);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(AGENT);
        assert!(refund.value() == 10_000_000);
        ts::return_to_address(AGENT, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Defense-in-depth: top_up blocked on disputed balance
    // ══════════════════════════════════════════════════════════════

    // top_up on a disputed balance should abort with EBalanceDisputed.
    // Added for consistency with claim, finalize_claim, agent_close,
    // provider_close — all of which check !disputed.
    #[test]
    #[expected_failure(abort_code = prepaid::EBalanceDisputed)]
    fun test_top_up_blocked_when_disputed() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        setup_v2_balance(&mut scenario, &clock, &state);

        // Provider claims 100 calls → pending
        scenario.next_tx(PROVIDER);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::claim(&mut bal, 100, &clock, scenario.ctx());
        ts::return_shared(bal);

        // Agent disputes with receipt #50
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        prepaid::dispute_claim(
            &mut bal,
            @0x06d553b842f768751ef60436013fd9a563de7986dc8991a2b3a8edb7037fc8ed,
            50,
            1700000000000,
            TEST_RESPONSE_HASH,
            TEST_SIG_CALL_50,
            &clock,
            scenario.ctx(),
        );
        assert!(prepaid::balance_disputed(&bal) == true);
        ts::return_shared(bal);

        // Agent tries to top up the disputed balance → should abort
        scenario.next_tx(AGENT);
        let mut bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        let extra = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        prepaid::top_up(&mut bal, extra, &state, &clock, scenario.ctx());

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // L2 documentation test: all-zero pubkey is accepted
    // ══════════════════════════════════════════════════════════════

    // Documents that deposit_with_receipts only validates pubkey LENGTH (32 bytes),
    // not CONTENT. An all-zero pubkey passes but makes disputes impossible
    // (no valid signature verifies against the zero key). This is a subset of
    // the L2 limitation (agent controls pubkey at deposit time).
    #[test]
    fun test_deposit_with_receipts_zero_pubkey_accepted() {
        let mut scenario = ts::begin(AGENT);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        let zero_pubkey = vector[
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        prepaid::deposit_with_receipts<SUI>(
            deposit, PROVIDER, RATE, UNLIMITED, DELAY_MS, 0, FEE_RECIPIENT,
            zero_pubkey, 300_000, // 5 min dispute window
            &state, &clock, scenario.ctx(),
        );

        // Balance created successfully — length check passes
        scenario.next_tx(AGENT);
        let bal = scenario.take_shared<prepaid::PrepaidBalance<SUI>>();
        assert!(prepaid::balance_remaining(&bal) == 1_000_000);
        assert!(prepaid::balance_dispute_window_ms(&bal) == 300_000);
        // The zero pubkey is stored — disputes will fail sig verification (L2)
        let expected = vector[
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        assert!(prepaid::balance_provider_pubkey(&bal) == &expected);

        ts::return_shared(bal);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
