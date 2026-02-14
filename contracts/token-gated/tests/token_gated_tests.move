#[test_only]
module token_gated::token_gated_tests {
    use token_gated::token_gated;
    use sui::test_scenario as ts;

    const ALICE: address = @0xA;

    // ══════════════════════════════════════════════════════════════
    // Happy path: valid approval
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_seal_approve_valid() {
        let mut scenario = ts::begin(ALICE);
        let ctx = ts::ctx(&mut scenario);

        let (cap, gate) = token_gated::create_token_gate<token_gated::TestNFT>(ctx);
        let nft = token_gated::create_test_nft(ctx);

        // Construct valid key ID: [gate_id_bytes][nonce]
        let mut id = object::id(&gate).to_bytes();
        id.push_back(0x01);
        id.push_back(0x02);

        token_gated::seal_approve<token_gated::TestNFT>(id, &nft, &gate);

        token_gated::destroy_test_nft_for_testing(nft);
        token_gated::destroy_cap_for_testing(cap);
        token_gated::freeze_token_gate(gate);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Multiple nonces for same gate
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_multiple_nonces() {
        let mut scenario = ts::begin(ALICE);
        let ctx = ts::ctx(&mut scenario);

        let (cap, gate) = token_gated::create_token_gate<token_gated::TestNFT>(ctx);
        let nft = token_gated::create_test_nft(ctx);

        let mut id1 = object::id(&gate).to_bytes();
        id1.push_back(0xAA);

        let mut id2 = object::id(&gate).to_bytes();
        id2.push_back(0xBB);
        id2.push_back(0xCC);

        // Both succeed — different nonces, same gate
        token_gated::seal_approve<token_gated::TestNFT>(id1, &nft, &gate);
        token_gated::seal_approve<token_gated::TestNFT>(id2, &nft, &gate);

        token_gated::destroy_test_nft_for_testing(nft);
        token_gated::destroy_cap_for_testing(cap);
        token_gated::freeze_token_gate(gate);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Wrong prefix rejected (key ID doesn't match gate)
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_wrong_prefix_rejected() {
        let mut scenario = ts::begin(ALICE);
        let ctx = ts::ctx(&mut scenario);

        let (cap, gate) = token_gated::create_token_gate<token_gated::TestNFT>(ctx);
        let nft = token_gated::create_test_nft(ctx);

        // Wrong key ID — doesn't start with gate_id bytes
        let mut bad_id = vector[];
        let mut i = 0;
        while (i < 32) {
            bad_id.push_back(0xFF);
            i = i + 1;
        };
        bad_id.push_back(0x01);

        // Aborts with ENoAccess (1)
        token_gated::seal_approve<token_gated::TestNFT>(bad_id, &nft, &gate);

        token_gated::destroy_test_nft_for_testing(nft);
        token_gated::destroy_cap_for_testing(cap);
        token_gated::freeze_token_gate(gate);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Wrong type rejected (type confusion defense-in-depth)
    // ══════════════════════════════════════════════════════════════

    public struct FakeNFT has key {
        id: UID,
    }

    #[test]
    #[expected_failure]
    fun test_wrong_type_rejected() {
        let mut scenario = ts::begin(ALICE);
        let ctx = ts::ctx(&mut scenario);

        let (cap, gate) = token_gated::create_token_gate<token_gated::TestNFT>(ctx);

        // Create a FakeNFT (wrong type)
        let fake = FakeNFT { id: object::new(ctx) };

        let mut id = object::id(&gate).to_bytes();
        id.push_back(0x01);

        // Aborts with ETypeMismatch (2)
        token_gated::seal_approve<FakeNFT>(id, &fake, &gate);

        let FakeNFT { id: uid } = fake;
        object::delete(uid);
        token_gated::destroy_cap_for_testing(cap);
        token_gated::freeze_token_gate(gate);
        ts::end(scenario);
    }

    // ══════════════════════════════════════════════════════════════
    // Empty ID rejected
    // ══════════════════════════════════════════════════════════════

    #[test]
    #[expected_failure]
    fun test_empty_id_rejected() {
        let mut scenario = ts::begin(ALICE);
        let ctx = ts::ctx(&mut scenario);

        let (cap, gate) = token_gated::create_token_gate<token_gated::TestNFT>(ctx);
        let nft = token_gated::create_test_nft(ctx);

        let empty_id = vector[];

        // Aborts with ENoAccess (1) — prefix check fails on empty ID
        token_gated::seal_approve<token_gated::TestNFT>(empty_id, &nft, &gate);

        token_gated::destroy_test_nft_for_testing(nft);
        token_gated::destroy_cap_for_testing(cap);
        token_gated::freeze_token_gate(gate);
        ts::end(scenario);
    }
}
