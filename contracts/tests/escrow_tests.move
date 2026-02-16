#[test_only]
module sweepay::escrow_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweepay::escrow;
    use sweepay::admin;

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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit,
            SELLER,
            ARBITER,
            DEADLINE_MS,
            50,             // 0.5% fee
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
        assert!(escrow::escrow_balance(&e) == 10_000);
        assert!(escrow::escrow_amount(&e) == 10_000);
        assert!(escrow::escrow_deadline_ms(&e) == DEADLINE_MS);
        assert!(escrow::escrow_state(&e) == 0); // STATE_ACTIVE
        assert!(escrow::escrow_fee_bps(&e) == 50);
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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, 1_000_000, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = escrow::EInvalidFeeBps)]
    fun test_create_invalid_fee_bps_fails() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 10_001, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 50, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer releases
        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // Verify receipt fields
        assert!(escrow::receipt_buyer(&receipt) == BUYER);
        assert!(escrow::receipt_seller(&receipt) == SELLER);
        assert!(escrow::receipt_amount(&receipt) == 10_000);
        assert!(escrow::receipt_fee_amount(&receipt) == 50); // 10000 * 50 / 10000 = 50
        assert!(escrow::receipt_released_by(&receipt) == BUYER);

        transfer::public_transfer(receipt, BUYER);

        // Verify seller received funds (10000 - 50 fee = 9950)
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 9_950);
        ts::return_to_address(SELLER, seller_coin);

        // Verify fee recipient got fee
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 50);
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
        let deposit = coin::mint_for_testing<SUI>(5_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        assert!(escrow::receipt_fee_amount(&receipt) == 0);
        assert!(escrow::receipt_amount(&receipt) == 5_000);

        transfer::public_transfer(receipt, BUYER);

        // Seller gets full amount
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 5_000);
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
        let deposit = coin::mint_for_testing<SUI>(1_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 10_000, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // 100% fee — all goes to fee recipient, nothing to seller
        assert!(escrow::receipt_fee_amount(&receipt) == 1_000);
        transfer::public_transfer(receipt, BUYER);

        // Fee recipient gets everything
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 1_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        assert!(escrow::receipt_amount(&receipt) == 10_000);

        transfer::public_transfer(receipt, BUYER);

        // Seller gets funds
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 10_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 50, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
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
        assert!(refund.value() == 10_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 50, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
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
        assert!(refund.value() == 10_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        // Arbiter griefing protection: if arbiter disappears, deadline still works
        let mut scenario = ts::begin(BUYER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 0, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        // Buyer disputes
        scenario.next_tx(BUYER);
        let mut e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::dispute(&mut e, &clock, scenario.ctx());
        ts::return_shared(e);

        // Advance past deadline — anyone can trigger refund even while disputed
        clock.set_for_testing(DEADLINE_MS + 1);

        scenario.next_tx(STRANGER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        escrow::refund<SUI>(e, &clock, scenario.ctx());

        // Buyer gets full refund
        scenario.next_tx(BUYER);
        let refund = scenario.take_from_address<coin::Coin<SUI>>(BUYER);
        assert!(refund.value() == 10_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());

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
            deposit, SELLER, ARBITER, DEADLINE_MS, 50, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
        );

        scenario.next_tx(BUYER);
        let e = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(e, &clock, scenario.ctx());

        // 10^18 * 50 / 10000 = 5 * 10^15
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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
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
        let deposit = coin::mint_for_testing<SUI>(50_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 200, FEE_RECIPIENT, b"digital art", &state, &clock, scenario.ctx(),
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
        assert!(escrow::receipt_amount(&receipt) == 50_000);
        assert!(escrow::receipt_fee_amount(&receipt) == 1_000); // 50000 * 200 / 10000
        assert!(escrow::receipt_released_by(&receipt) == ARBITER);

        transfer::public_transfer(receipt, BUYER);

        // Seller: 50000 - 1000 = 49000
        scenario.next_tx(SELLER);
        let seller_coin = scenario.take_from_address<coin::Coin<SUI>>(SELLER);
        assert!(seller_coin.value() == 49_000);
        ts::return_to_address(SELLER, seller_coin);

        // Fee: 1000
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 1_000);
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
        let deposit = coin::mint_for_testing<SUI>(50_000, scenario.ctx());

        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 200, FEE_RECIPIENT, b"digital art", &state, &clock, scenario.ctx(),
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
        assert!(refund.value() == 50_000);
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
        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
        escrow::create<SUI>(
            deposit, SELLER, ARBITER, DEADLINE_MS, 50, FEE_RECIPIENT, b"", &state, &clock, scenario.ctx(),
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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
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

        let deposit = coin::mint_for_testing<SUI>(10_000, scenario.ctx());
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
}
