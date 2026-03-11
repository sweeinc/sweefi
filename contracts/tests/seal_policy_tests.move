#[test_only]
module sweefi::seal_policy_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweefi::escrow;
    use sweefi::seal_policy;
    use sweefi::admin;

    const BUYER: address = @0xCAFE;
    const SELLER: address = @0xBEEF;
    const ARBITER: address = @0xDAD;
    const FEE_RECIPIENT: address = @0xFEE;
    const ATTACKER: address = @0xBAD;
    const BOB: address = @0xB0B;          // secondary buyer for bearer transfer tests
    const AGENT_ADDR: address = @0xA6E4;  // AI agent for delegation tests

    /// Helper: create escrow and release it, producing an EscrowReceipt for BUYER.
    /// Returns the escrow_id for key ID construction.
    fun setup_released_escrow(scenario: &mut ts::Scenario, clock: &clock::Clock) {
        // Buyer creates escrow
        let deposit = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());
        let (_cap, state) = admin::create_for_testing(scenario.ctx());
        escrow::create<SUI>(
            deposit,
            SELLER,
            ARBITER,
            999_999_999, // far future deadline
            20_000,      // 2% fee
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
    fun test_seal_approve_bearer_model_any_holder_can_decrypt() {
        // BEARER MODEL (H-1 fix): whoever holds the EscrowReceipt object can decrypt.
        // Pre-fix: check_policy checked ctx.sender() == receipt.buyer, locking decryption
        //   to the original buyer's address forever — breaking agent delegation (ADR-005).
        // Post-fix: only the key_id prefix is checked. Sui's object ownership model IS
        //   the authorization — only the address that owns the receipt can include it in
        //   a transaction (no additional identity check needed or correct).
        //
        // This test uses test_scenario's take_from_address to simulate a scenario where
        // a non-buyer address holds the receipt. With the bearer model, this now succeeds.
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        // Simulate non-buyer holding receipt (e.g., after a transfer)
        scenario.next_tx(ATTACKER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        let mut key_id = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id.push_back(1);

        // Bearer model: holder of the receipt CAN decrypt — no sender identity check
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

    // ══════════════════════════════════════════════════════════════
    // Bearer transfer tests (T-1, T-2) — H-1 fix validation
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_seal_approve_bearer_transfer_new_holder_succeeds() {
        // T-1: Bearer transfer test. BUYER receives EscrowReceipt → transfers to BOB
        // → BOB calls seal_approve successfully.
        //
        // BOB was never involved in the original escrow, but holding the receipt IS the
        // authorization (ADR-005 bearer model). This is the digital concert ticket model:
        // transferring the receipt transfers the decryption right.
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        // BUYER explicitly transfers receipt to BOB (e.g., secondary sale or gift)
        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);
        transfer::public_transfer(receipt, BOB);

        // BOB now owns the receipt and presents it to the SEAL key server → MUST succeed
        scenario.next_tx(BOB);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BOB);
        let mut key_id = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id.push_back(99); // arbitrary nonce — receipt unlocks any content under this escrow
        seal_policy::seal_approve(key_id, &receipt, scenario.ctx());

        ts::return_to_address(BOB, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_seal_approve_agent_delegation_succeeds() {
        // T-2: AI agent delegation (core SweeFi use case, ADR-005 §3).
        // Human wallet pays → escrow released → BUYER delegates receipt to AI AGENT.
        // AGENT calls seal_approve to decrypt content (e.g., model weights, API key).
        //
        // The agent never touches funds — it only holds the receipt (proof of payment).
        // Human authorizes payment; agent exercises the access right. Clean separation.
        //
        //   Human wallet ──pays──> Seller (gets funds)
        //        │
        //        └──transfers receipt──> AI Agent ──seal_approve──> decrypted content
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        // BUYER delegates decryption rights to AGENT by transferring the receipt
        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);
        transfer::public_transfer(receipt, AGENT_ADDR);

        // AGENT presents receipt to SEAL key server → MUST succeed (bearer model)
        scenario.next_tx(AGENT_ADDR);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(AGENT_ADDR);
        let mut key_id = escrow::receipt_escrow_id(&receipt).to_bytes();
        key_id.push_back(1);
        seal_policy::seal_approve(key_id, &receipt, scenario.ctx());

        ts::return_to_address(AGENT_ADDR, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // PART A: Adversarial Scenario Documentation (Seal Policy)
    // ══════════════════════════════════════════════════════════════
    //
    // A1: Receipt forgery — structurally impossible in Move.
    //
    // PaymentReceipt and EscrowReceipt are defined with `key, store` abilities
    // but NO public constructor. The only way to mint an EscrowReceipt is via
    // escrow::release() which requires a valid Escrow object (itself only
    // created by escrow::create with real funds). There is no
    // `create_receipt_for_testing()` or `new()` function exposed.
    //
    // In Move, you cannot construct a struct from outside its defining module
    // unless a public constructor function exists. The type system enforces this
    // at compile time — there is nothing to test at runtime.
    //
    // A2: Wrong receipt type — also structurally impossible.
    //
    // seal_approve takes `receipt: &escrow::EscrowReceipt` — passing a
    // PaymentReceipt (different struct type) would fail at compile time.
    // Move's type system is nominally typed — escrow::EscrowReceipt and
    // payment::PaymentReceipt are distinct types even if they had identical fields.
    // No runtime test is possible or needed.
    //
    // Both attacks are prevented by Move's type system, which is a STRONGER
    // guarantee than any runtime check. Documented here for the security audit trail.
    // ══════════════════════════════════════════════════════════════

    // ── Adversarial: wrong escrow ID prefix still fails ──────────
    // Reinforces that only the exact escrow_id prefix unlocks decryption.
    // Even a single-byte difference in the prefix is caught.
    #[test]
    #[expected_failure(abort_code = seal_policy::ENoAccess)]
    fun test_adversarial_seal_policy_partial_prefix_mismatch() {
        let mut scenario = ts::begin(BUYER);
        let clock = clock::create_for_testing(scenario.ctx());

        setup_released_escrow(&mut scenario, &clock);

        scenario.next_tx(BUYER);
        let receipt = scenario.take_from_address<escrow::EscrowReceipt>(BUYER);

        // Construct key_id with correct length but wrong first byte
        let correct_prefix = escrow::receipt_escrow_id(&receipt).to_bytes();
        let mut bad_key_id = correct_prefix;
        // Flip the first byte
        let first_byte = bad_key_id[0];
        let flipped = if (first_byte == 0) { 1u8 } else { 0u8 };
        *bad_key_id.borrow_mut(0) = flipped;
        bad_key_id.push_back(1); // nonce

        // Should fail — prefix doesn't match
        seal_policy::seal_approve(bad_key_id, &receipt, scenario.ctx());

        ts::return_to_address(BUYER, receipt);
        clock.destroy_for_testing();
        scenario.end();
    }
}
