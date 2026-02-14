#[test_only]
module sweepay::seal_policy_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweepay::escrow;
    use sweepay::seal_policy;
    use sweepay::admin;

    const BUYER: address = @0xCAFE;
    const SELLER: address = @0xBEEF;
    const ARBITER: address = @0xDAD;
    const FEE_RECIPIENT: address = @0xFEE;
    const ATTACKER: address = @0xBAD;

    /// Helper: create escrow and release it, producing an EscrowReceipt for BUYER.
    /// Returns the escrow_id for key ID construction.
    fun setup_released_escrow(scenario: &mut ts::Scenario, clock: &clock::Clock) {
        // Buyer creates escrow
        let deposit = coin::mint_for_testing<SUI>(50_000, scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        escrow::create<SUI>(
            deposit,
            SELLER,
            ARBITER,
            999_999_999, // far future deadline
            200,         // 2% fee
            FEE_RECIPIENT,
            b"SEAL demo",
            &state,
            clock,
            scenario.ctx(),
        );
        admin::destroy_cap_for_testing(_cap);
        admin::destroy_state_for_testing(state);

        // Buyer releases escrow → receipt minted
        scenario.next_tx(BUYER);
        let esc = scenario.take_shared<escrow::Escrow<SUI>>();
        let receipt = escrow::release<SUI>(esc, clock, scenario.ctx());
        transfer::public_transfer(receipt, BUYER);
    }

    // ══════════════════════════════════════════════════════════════
    // seal_approve tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_seal_approve_valid() {
        // Full flow: create escrow → release → buyer decrypts via SEAL
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        // Buyer presents receipt to SEAL key server
        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        // Construct key ID: [escrow_id_bytes][nonce]
        let mut key_id = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id.push_back(42); // arbitrary nonce

        // seal_approve should NOT abort
        seal_policy::seal_approve(key_id, &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_seal_approve_multiple_nonces() {
        // Same receipt can decrypt multiple items (different nonces)
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);
        let escrow_id_bytes = escrow::receipt_escrow_id(&receipt).to_bytes();

        // Nonce 1
        let mut key_id_1 = escrow_id_bytes;
        key_id_1.push_back(1);
        seal_policy::seal_approve(key_id_1, &receipt, scenario.ctx());

        // Nonce 2 (different content, same escrow)
        let mut key_id_2 = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id_2.push_back(2);
        key_id_2.push_back(99);
        seal_policy::seal_approve(key_id_2, &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = seal_policy::ENoAccess)]
    fun test_seal_approve_wrong_caller() {
        // Attacker with no receipt tries to decrypt → denied
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        // Attacker tries to use buyer's receipt
        scenario.next_tx(ATTACKER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        let mut key_id = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id.push_back(1);

        // Should abort — ATTACKER is not the buyer
        seal_policy::seal_approve(key_id, &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = seal_policy::ENoAccess)]
    fun test_seal_approve_wrong_escrow_id() {
        // Receipt from escrow A can't decrypt content for escrow B
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        // Bogus key ID that doesn't match the receipt's escrow_id
        let key_id = b"wrong_escrow_id_does_not_match_at_all";

        // Should abort — prefix doesn't match
        seal_policy::seal_approve(key_id, &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = seal_policy::ENoAccess)]
    fun test_seal_approve_empty_id() {
        // Empty key ID → prefix check fails (too short)
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        // Empty ID — shorter than the 32-byte escrow_id prefix
        seal_policy::seal_approve(b"", &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }
}
