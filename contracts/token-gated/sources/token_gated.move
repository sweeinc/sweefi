/// Token-gated SEAL access pattern
///
/// Gates decryption access on ownership of any token type `T: key`.
/// This is the first SEAL pattern to use generics on seal_approve,
/// enabling a universal "access travels with the asset" pattern.
///
/// How it works:
///   1. Creator deploys a TokenGate for type T (e.g., MyNFT)
///   2. Gate is frozen → immutable, no consensus overhead on reads
///   3. Content is encrypted with key ID = [gate_id_bytes][nonce]
///   4. To decrypt, holder calls seal_approve<T>(id, &their_token, &gate)
///   5. SEAL key servers dry-run the PTB — if it doesn't abort, key is released
///
/// Security model:
///   - Move VM enforces ownership: only the owner can pass &T as tx argument
///   - TypeName check prevents type confusion (defense-in-depth)
///   - Prefix check binds encryption keys to a specific gate instance
///   - Frozen gate = no admin can change access rules after creation
///
/// Caveat: Only works for owned objects. Shared/frozen T would bypass the gate
/// since anyone can obtain &T. This is an intentional tradeoff for the
/// "access travels with the asset" property.
///
/// Reference: https://github.com/MystenLabs/seal/issues/466
#[allow(lint(self_transfer))]
module token_gated::token_gated {
    use std::type_name;

    // ══════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════

    const ENoAccess: u64 = 1;
    const ETypeMismatch: u64 = 2;

    // ══════════════════════════════════════════════════════════════
    // Structs
    // ══════════════════════════════════════════════════════════════

    /// The gate object. Stores which token type T is required for access.
    /// Only has `key` (no `store`) — frozen after creation, cannot be wrapped.
    public struct TokenGate has key {
        id: UID,
        /// The type of token required for access (defense-in-depth check)
        required_type: type_name::TypeName,
    }

    /// Admin capability tied to a specific gate.
    /// Has `key + store` for transferability. Reserved for future extensibility
    /// (e.g., versioned shared object admin pattern, gate metadata updates).
    public struct Cap has key, store {
        id: UID,
        gate_id: ID,
    }

    /// A simple NFT for testnet verification of the token-gated pattern.
    /// NOT #[test_only] — must be callable on testnet for E2E SEAL demo.
    public struct TestNFT has key, store {
        id: UID,
    }

    // ══════════════════════════════════════════════════════════════
    // Gate creation
    // ══════════════════════════════════════════════════════════════

    /// Create a token gate for type T and its admin cap.
    /// Caller is responsible for freezing the gate and transferring the cap.
    public fun create_token_gate<T: key>(ctx: &mut TxContext): (Cap, TokenGate) {
        let gate = TokenGate {
            id: object::new(ctx),
            // with_original_ids survives package upgrades (unlike type_name::get)
            required_type: type_name::with_original_ids<T>(),
        };
        let cap = Cap {
            id: object::new(ctx),
            gate_id: object::id(&gate),
        };
        (cap, gate)
    }

    /// Freeze the gate as an immutable object.
    /// After this, no one can modify or delete it — reads have zero consensus overhead.
    public fun freeze_token_gate(gate: TokenGate) {
        transfer::freeze_object(gate);
    }

    /// Convenience entry function: create gate, freeze it, transfer cap to sender.
    /// This is what most creators will call.
    entry fun create_token_gate_entry<T: key>(ctx: &mut TxContext) {
        let (cap, gate) = create_token_gate<T>(ctx);
        freeze_token_gate(gate);
        transfer::transfer(cap, ctx.sender());
    }

    // ══════════════════════════════════════════════════════════════
    // SEAL entry point
    // ══════════════════════════════════════════════════════════════

    /// SEAL approval: verifies the caller owns a token of type T
    /// and the key ID is bound to this gate.
    ///
    /// Key ID format: [gate_id_bytes (32)][arbitrary_nonce]
    ///
    /// The _token parameter is taken by reference — the Move VM enforces
    /// that only the owner can provide &T as a transaction argument.
    /// We never explicitly check ownership; if you can provide &T, you own it.
    entry fun seal_approve<T: key>(
        id: vector<u8>,
        _token: &T,
        gate: &TokenGate,
    ) {
        assert!(check_policy<T>(id, _token, gate), ENoAccess);
    }

    // ══════════════════════════════════════════════════════════════
    // Policy logic (testable)
    // ══════════════════════════════════════════════════════════════

    /// Check that:
    ///   1. The generic type T matches the gate's required_type (defense-in-depth)
    ///   2. The key ID starts with the gate's object ID bytes (prefix binding)
    fun check_policy<T: key>(
        id: vector<u8>,
        _token: &T,
        gate: &TokenGate,
    ): bool {
        // Defense-in-depth: verify type matches even though Move's type system
        // already constrains T. Prevents type confusion if someone manages to
        // call with a different T that happens to share the same layout.
        assert!(
            type_name::with_original_ids<T>() == gate.required_type,
            ETypeMismatch,
        );

        // Key ID must start with the gate's object ID bytes
        let prefix = object::id(gate).to_bytes();
        let prefix_len = prefix.length();
        if (prefix_len > id.length()) {
            return false
        };

        let mut i = 0;
        while (i < prefix_len) {
            if (prefix[i] != id[i]) {
                return false
            };
            i = i + 1;
        };
        true
    }

    // ══════════════════════════════════════════════════════════════
    // TestNFT helpers (for testnet E2E verification)
    // ══════════════════════════════════════════════════════════════

    /// Mint a TestNFT and transfer to the caller.
    entry fun mint_test_nft_entry(ctx: &mut TxContext) {
        let nft = TestNFT { id: object::new(ctx) };
        transfer::transfer(nft, ctx.sender());
    }

    /// Destroy a TestNFT (cleanup).
    entry fun destroy_test_nft(nft: TestNFT) {
        let TestNFT { id } = nft;
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun create_test_nft(ctx: &mut TxContext): TestNFT {
        TestNFT { id: object::new(ctx) }
    }

    #[test_only]
    public fun destroy_test_nft_for_testing(nft: TestNFT) {
        let TestNFT { id } = nft;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_cap_for_testing(cap: Cap) {
        let Cap { id, gate_id: _ } = cap;
        object::delete(id);
    }
}
