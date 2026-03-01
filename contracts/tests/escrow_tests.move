#[test_only]
module sweefi::escrow_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweefi::escrow;
    use sweefi::admin;

    const BUYER: address = @0xCAFE;
    const SELLER: address = @0xBEEF;
    const ARBITER: address = @0xA4B1;
    const FEE_RECIPIENT: address = @0xFEE;
    const STRANGER: address = @0xDEAD;

    // Deadline: 1 hour from clock=0 (3,600,000 ms)
    const DEADLINE_MS: u64 = 3_600_000;

    // ══════════════════════════════════════════════════════════════
    // Create tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_create_escrow() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit,
            SELLER,
            ARBITER,
            DEADLINE_MS,
            5_000,          // 0.5% fee
            FEE_RECIPIENT,
            b"deliver NFT",
            &state,
            &clock,
            scenario.ctx(),
        );

        // Verify escrow was shared
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        assert!(escrow::escrow_buyer(&e) == BUYER);
        assert!(escrow::escrow_seller(&e) == SELLER);
        assert!(escrow::escrow_arbiter(&e) == ARBITER);
        assert!(escrow::escrow_balance(&e) == 1_000_000);
        assert!(escrow::escrow_amount(&e) == 1_000_000);
        assert!(escrow::escrow_deadline_ms(&e) == DEADLINE_MS);
        assert!(escrow::escrow_state(&e) == 0); // STATE_ACTIVE
        assert!(escrow::escrow_fee_micro_pct(&e) == 5_000);
        assert!(escrow::escrow_description(&e) == &b"deliver NFT");

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EZeroAmount)]
    fun test_create_zero_deposit_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(0, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EDeadlineInPast)]
    fun test_create_deadline_in_past_fails() {
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        clock.set_for_testing(5_000_000); // clock is ahead of deadline

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, 1_000_000, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EInvalidFeeMicroPct)]
    fun test_create_invalid_fee_micro_pct_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 1_000_001, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EArbiterIsSeller)]
    fun test_create_arbiter_is_seller_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // Seller == Arbiter: seller could dispute→release to bypass buyer consent
        escrow::create<SUI>(
            deposit, SELLER, SELLER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EDescriptionTooLong)]
    fun test_create_description_too_long_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // 1025 bytes — over the 1024 limit
        let mut desc = vector[];
        let mut i = 0;
        while (i < 1025) {
            desc.push_back(65u8); // 'A'
            i = i + 1;
        };

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, desc, &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Release tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_release_by_buyer() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer releases
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // Verify receipt fields
        assert!(escrow::receipt_buyer(&receipt) == BUYER);
        assert!(escrow::receipt_seller(&receipt) == SELLER);
        assert!(escrow::receipt_amount(&receipt) == 1_000_000);
        assert!(escrow::receipt_fee_amount(&receipt) == 5_000); // 1_000_000 * 5_000 / 1_000_000 = 5_000
        assert!(escrow::receipt_released_by(&receipt) == BUYER);

        transfer::public_transfer(receipt, BUYER);

        // Verify seller received funds (1_000_000 - 5_000 fee = 995_000)
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 995_000); // 1_000_000 - 5_000 fee (5_000 fee_micro_pct)
        ts::return_to_address(SELLER, seller_coin);

        // Verify fee recipient got fee
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 5_000); // 1_000_000 * 5_000 fee_micro_pct / 1_000_000
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_with_zero_fee() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        assert!(escrow::receipt_fee_amount(&receipt) == 0);
        assert!(escrow::receipt_amount(&receipt) == 1_000_000);

        transfer::public_transfer(receipt, BUYER);

        // Seller gets full amount
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 1_000_000); // zero fee — seller gets full deposit
        ts::return_to_address(SELLER, seller_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_max_fee_100_percent() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 1_000_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // 100% fee — all goes to fee recipient, nothing to seller
        assert!(escrow::receipt_fee_amount(&receipt) == 1_000_000);
        transfer::public_transfer(receipt, BUYER);

        // Fee recipient gets everything
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 1_000_000); // 100% fee on 1_000_000 deposit
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_by_arbiter_after_dispute() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        assert!(escrow::escrow_state(&e) == 1); // STATE_DISPUTED
        ts::return_shared(e);

        // Arbiter releases (resolves in seller's favor)
        scenario.next_tx(ARBITER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        assert!(escrow::receipt_released_by(&receipt) == ARBITER);
        assert!(escrow::receipt_amount(&receipt) == 1_000_000);

        transfer::public_transfer(receipt, BUYER);

        // Seller gets funds
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 1_000_000);
        ts::return_to_address(SELLER, seller_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::ENotBuyer)]
    fun test_release_by_non_buyer_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Seller tries to release when ACTIVE — only buyer can
        scenario.next_tx(SELLER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());
        transfer::public_transfer(receipt, BUYER);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::ENotArbiter)]
    fun test_release_by_non_arbiter_on_disputed_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Buyer tries to release when DISPUTED — only arbiter can
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());
        transfer::public_transfer(receipt, BUYER);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Refund tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_refund_after_deadline() {
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance past deadline
        clock.set_for_testing(DEADLINE_MS + 1);

        // Anyone can trigger refund after deadline (permissionless)
        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // No fee on refund — buyer gets full amount back
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(BUYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_seller_triggers_permissionless_refund_buyer_gets_funds() {
        // T-7: refund() after deadline is permissionless — caller is irrelevant to destination.
        //
        // SELLER calls refund() after the deadline. Key invariants to verify:
        //   1. Refund SUCCEEDS even though SELLER is the caller (truly permissionless)
        //   2. Funds go to BUYER (not SELLER — destination is hardcoded to escrow.buyer)
        //   3. No fee is deducted on refund (fee_micro_pct only applies to release)
        //
        // This test differs from test_refund_after_deadline (which uses STRANGER) by
        // explicitly verifying that an economically adversarial caller (SELLER) cannot
        // redirect refund funds to themselves. "Caller triggers" ≠ "caller receives."
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        // Create escrow with 2% fee (but fee does NOT apply to refunds)
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 20_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance past deadline
        clock.set_for_testing(DEADLINE_MS + 1);

        // SELLER triggers the permissionless refund — this works because refund()
        // has no caller restriction after the deadline
        scenario.next_tx(SELLER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // BUYER receives the full deposit — no fee on refunds, regardless of caller
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000); // full 1M — fee_micro_pct=200 does NOT apply to refunds
        ts::return_to_address(BUYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EDeadlineNotReached)]
    fun test_refund_before_deadline_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Try to refund before deadline — should fail
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_refund_by_arbiter_after_dispute() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Seller disputes
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Arbiter refunds (resolves in buyer's favor)
        scenario.next_tx(ARBITER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // No fee on refund
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(BUYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::ENotArbiter)]
    fun test_refund_by_non_arbiter_on_disputed_before_deadline_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Buyer tries refund before deadline on disputed — only arbiter can
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_deadline_refund_on_disputed_escrow() {
        // Arbiter griefing protection: if arbiter disappears, deadline still works.
        // Note: dispute() may extend deadline via grace period, so we advance
        // past the *effective* deadline, not the original one.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        let effective_deadline = escrow::escrow_deadline_ms(&e);
        ts::return_shared(e);

        // Advance past effective deadline (may be extended by grace period)
        clock.set_for_testing(effective_deadline + 1);

        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // Buyer gets full refund
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(BUYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Dispute tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_dispute_by_buyer() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        assert!(escrow::escrow_state(&e) == 1); // STATE_DISPUTED

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_dispute_by_seller() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Seller disputes (buyer won't release despite delivery)
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        assert!(escrow::escrow_state(&e) == 1); // STATE_DISPUTED

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EAlreadyDisputed)]
    fun test_dispute_already_disputed_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        // Try to dispute again — should fail
        scenario.next_tx(SELLER);
        escrow::dispute(&mut e, &clock, scenario.ctx());

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::ENotAuthorized)]
    fun test_dispute_by_arbiter_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Arbiter tries to dispute — only buyer/seller can
        scenario.next_tx(ARBITER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Integration / edge case tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_receipt_escrow_id_matches() {
        // SEAL integration: the receipt's escrow_id must match the original escrow
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();

        // Capture escrow ID before release consumes it
        let escrow_id = object::id(&e);

        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // Verify SEAL anchor: receipt.escrow_id == original escrow ID
        assert!(escrow::receipt_escrow_id(&receipt) == escrow_id);

        transfer::public_transfer(receipt, BUYER);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_fee_overflow_protection() {
        // Large amount: verify u128 intermediate prevents overflow
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());

        let large_amount: u64 = 1_000_000_000_000_000_000; // 10^18
        let deposit = coin::mint_for_testing<SUI>(large_amount, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // 10^18 * 5_000 / 1_000_000 = 5 * 10^15
        assert!(escrow::receipt_fee_amount(&receipt) == 5_000_000_000_000_000);

        transfer::public_transfer(receipt, BUYER);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_has_clock_timestamp() {
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        clock.set_for_testing(1707700000000); // specific timestamp

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, 1707700000000 + DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        assert!(escrow::receipt_released_at_ms(&receipt) == 1707700000000);

        transfer::public_transfer(receipt, BUYER);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_full_dispute_flow_release() {
        // Full flow: create → dispute → arbiter release → verify receipt
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 20_000, FEE_RECIPIENT, b"digital art", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Arbiter investigates and releases to seller
        scenario.next_tx(ARBITER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // Verify receipt
        assert!(escrow::receipt_amount(&receipt) == 1_000_000);
        assert!(escrow::receipt_fee_amount(&receipt) == 20_000); // 1_000_000 * 20_000 / 1_000_000
        assert!(escrow::receipt_released_by(&receipt) == ARBITER);

        transfer::public_transfer(receipt, BUYER);

        // Seller: 50000 - 1000 = 49000
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 980_000); // 1_000_000 - 20_000 fee (20_000 fee_micro_pct)
        ts::return_to_address(SELLER, seller_coin);

        // Fee: 1000
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 20_000); // 1_000_000 * 20_000 / 1_000_000
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_full_dispute_flow_refund() {
        // Full flow: create → dispute → arbiter refund → verify buyer gets everything
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 20_000, FEE_RECIPIENT, b"digital art", &state, &clock, scenario.ctx(),
        );

        // Seller disputes (buyer won't release)
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Arbiter investigates and refunds to buyer
        scenario.next_tx(ARBITER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // No fee on refund — buyer gets full amount
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(BUYER, refund);

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
    fun test_create_escrow_while_paused_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Try to create an escrow — should fail
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_release_while_protocol_paused_succeeds() {
        // User withdrawals must ALWAYS work, even when protocol is paused
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Buyer should still be able to release (withdrawal always allowed)
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());
        transfer::public_transfer(receipt, BUYER);

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_refund_while_protocol_paused_succeeds() {
        // User withdrawals must ALWAYS work, even when protocol is paused
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance past deadline
        clock.set_for_testing(DEADLINE_MS + 1);

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Anyone should still be able to trigger refund (withdrawal always allowed)
        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_dispute_while_protocol_paused_succeeds() {
        // Dispute is a user action, must work even when paused
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (cap, mut state) = admin::create_for_testing(scenario.ctx());

        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Pause the protocol
        admin::pause(&cap, &mut state, scenario.ctx());

        // Buyer should still be able to dispute (user action, always allowed)
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        assert!(escrow::escrow_state(&e) == 1); // STATE_DISPUTED

        ts::return_shared(e);
        admin::destroy_cap_for_testing(cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Dispute grace period tests
    //
    // The grace period prevents a race condition on DISPUTED escrows
    // after the deadline passes. Without it, a buyer's refund bot can
    // front-run the arbiter's release(), enabling theft (buyer keeps
    // goods + gets full refund).
    //
    // Grace = clamp(original_duration × 50%, 7 days, 30 days)
    //   GRACE_FLOOR_MS = 604_800_000  (7 days)
    //   GRACE_CAP_MS   = 2_592_000_000 (30 days)
    // ══════════════════════════════════════════════════════════════

    // Helper constants for grace period tests
    // 1 day = 86_400_000 ms
    const ONE_DAY_MS: u64 = 86_400_000;
    // 7 days = 604_800_000 ms (grace floor)
    const SEVEN_DAYS_MS: u64 = 604_800_000;
    // 30 days = 2_592_000_000 ms (grace cap)
    const THIRTY_DAYS_MS: u64 = 2_592_000_000;

    #[test]
    fun test_dispute_extends_deadline_when_close_to_expiry() {
        // Scenario: 7-day escrow, dispute filed on day 6 (1 day remaining).
        // Grace = clamp(7d × 50%, 7d, 30d) = 7d (floor).
        // New deadline = day 6 + 7 days = day 13.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = SEVEN_DAYS_MS; // 7 day escrow
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance to day 6 (1 day before deadline)
        let day_6 = 6 * ONE_DAY_MS;
        clock.set_for_testing(day_6);

        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        // Deadline should be extended: day 6 + 7 days grace = day 13
        assert!(escrow::escrow_deadline_ms(&e) == day_6 + SEVEN_DAYS_MS);
        // Verify it's beyond the original deadline
        assert!(escrow::escrow_deadline_ms(&e) > deadline);

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_dispute_does_not_extend_when_far_from_expiry() {
        // Scenario: 90-day escrow, dispute filed on day 1 (89 days remaining).
        // Grace = clamp(90d × 50%, 7d, 30d) = 30d (cap).
        // min_deadline = day 1 + 30 days = day 31.
        // Original deadline = day 90. 31 < 90, so deadline unchanged.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = 90 * ONE_DAY_MS; // 90-day escrow
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 1
        let day_1 = ONE_DAY_MS;
        clock.set_for_testing(day_1);

        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        // Deadline should NOT change — 89 days remaining > 30 day grace cap
        assert!(escrow::escrow_deadline_ms(&e) == deadline);

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_arbiter_release_after_original_deadline_within_grace() {
        // THE KEY RACE CONDITION TEST.
        // Before the fix: arbiter's release() could be front-run by refund().
        // After the fix: refund() blocked during grace period, arbiter release() works.
        //
        // Scenario: 7-day escrow, dispute on day 6.
        // Grace extends deadline to day 13.
        // On day 8 (past original deadline, within grace), arbiter releases.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = SEVEN_DAYS_MS;
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 5_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 6
        clock.set_for_testing(6 * ONE_DAY_MS);
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Day 8 — past original 7-day deadline, but within grace period
        clock.set_for_testing(8 * ONE_DAY_MS);

        // Arbiter releases (this is the fix — without grace, a refund bot could race this)
        scenario.next_tx(ARBITER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        assert!(escrow::receipt_released_by(&receipt) == ARBITER);
        assert!(escrow::receipt_amount(&receipt) == 1_000_000);
        transfer::public_transfer(receipt, BUYER);

        // Verify seller got paid
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 995_000); // 1M - 5_000 fee
        ts::return_to_address(SELLER, seller_coin);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::ENotArbiter)]
    fun test_permissionless_refund_blocked_during_grace_period() {
        // After dispute extends deadline, permissionless refund should fail
        // during the grace window — even though we're past the ORIGINAL deadline.
        // Error is ENotArbiter (not EDeadlineNotReached) because the refund logic
        // for DISPUTED + pre-deadline escrows requires arbiter authorization.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = SEVEN_DAYS_MS;
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 6
        clock.set_for_testing(6 * ONE_DAY_MS);
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Day 8 — past original deadline (7d), but within grace (extends to day 13)
        clock.set_for_testing(8 * ONE_DAY_MS);

        // Stranger tries permissionless refund — should FAIL
        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx()); // aborts ENotArbiter

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_permissionless_refund_succeeds_after_grace_period() {
        // After the grace period expires, permissionless refund works again.
        // This is the arbiter griefing protection: if arbiter disappears,
        // funds are not locked forever.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = SEVEN_DAYS_MS;
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 6 → grace extends deadline to day 13
        clock.set_for_testing(6 * ONE_DAY_MS);
        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        let extended_deadline = escrow::escrow_deadline_ms(&e);
        ts::return_shared(e);

        // Advance past extended deadline
        clock.set_for_testing(extended_deadline + 1);

        // Permissionless refund now works
        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // Buyer gets full refund (no fee on refund)
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 1_000_000);
        ts::return_to_address(BUYER, refund);

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_grace_period_proportional_30day_escrow() {
        // 30-day escrow: grace = clamp(30d × 50%, 7d, 30d) = 15 days.
        // Dispute on day 28 (2 days remaining).
        // New deadline = day 28 + 15 days = day 43.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = 30 * ONE_DAY_MS; // 30-day escrow
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 28
        let day_28 = 28 * ONE_DAY_MS;
        clock.set_for_testing(day_28);

        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        // Grace = 30d × 50% = 15d. New deadline = day 28 + 15d = day 43
        let expected_deadline = day_28 + 15 * ONE_DAY_MS;
        assert!(escrow::escrow_deadline_ms(&e) == expected_deadline);

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_grace_period_caps_at_30_days() {
        // 120-day escrow: grace = clamp(120d × 50%, 7d, 30d) = 30 days (cap).
        // Dispute on day 115 (5 days remaining).
        // New deadline = day 115 + 30 days = day 145.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        let deadline = 120 * ONE_DAY_MS; // 120-day escrow
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, deadline, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Dispute on day 115
        let day_115 = 115 * ONE_DAY_MS;
        clock.set_for_testing(day_115);

        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());

        // Grace = 120d × 50% = 60d, capped at 30d.
        // New deadline = day 115 + 30d = day 145
        let expected_deadline = day_115 + THIRTY_DAYS_MS;
        assert!(escrow::escrow_deadline_ms(&e) == expected_deadline);

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // M-01: Post-deadline dispute blocked (pre-publication audit 2026-02-28)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure(abort_code = escrow::EDeadlineReached)]
    fun test_dispute_after_deadline_by_seller_fails() {
        // M-01: Seller cannot dispute after deadline.
        // After deadline, permissionless refund is the buyer's unconditional guarantee.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance past deadline
        clock.set_for_testing(DEADLINE_MS + 1);

        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx()); // should abort

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EDeadlineReached)]
    fun test_dispute_after_deadline_by_buyer_fails() {
        // M-01: Buyer also cannot dispute after deadline.
        // Consistent enforcement — deadline is absolute for all parties.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Advance past deadline
        clock.set_for_testing(DEADLINE_MS + 1);

        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx()); // should abort

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_dispute_just_before_deadline_succeeds() {
        // Sanity check: dispute at deadline - 1ms still works.
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // 1ms before deadline — dispute should succeed
        clock.set_for_testing(DEADLINE_MS - 1);

        scenario.next_tx(SELLER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        assert!(escrow::escrow_state(&e) == 1); // STATE_DISPUTED

        ts::return_shared(e);
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }
}
