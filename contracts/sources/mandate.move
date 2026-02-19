/// SweeFi Mandate — AP2-compatible agent spending authorization
///
/// A Mandate authorizes a delegate (AI agent) to spend on behalf of a
/// delegator (human). Mandates are OWNED by the delegate for efficiency:
///   - No consensus overhead (owned object, not shared)
///   - No front-running risk
///   - Fast single-owner transactions
///
/// AP2 alignment: implements the Agent Payments Protocol spending
/// authorization concept on Sui. Mandates are the on-chain primitive
/// that enables "human authorizes agent to pay up to X per transaction,
/// Y total, until expiry."
///
/// Revocation: delegator can revoke by setting a flag in a shared
/// revocation registry. Mandate checks this before every spend.
///
/// Error codes: 400-series (payment=0, stream=100, escrow=200, seal=300, mandate=400)
#[allow(lint(self_transfer))]
module sweefi::mandate {
    use sui::clock::Clock;
    use sui::dynamic_field as df;

    // ══════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════

    const ENotDelegate: u64 = 400;
    const EExpired: u64 = 401;
    const EPerTxLimitExceeded: u64 = 402;
    const ETotalLimitExceeded: u64 = 403;
    const ENotDelegator: u64 = 404;
    const ERevoked: u64 = 405;

    // ══════════════════════════════════════════════════════════════
    // Structs
    // ══════════════════════════════════════════════════════════════

    /// Spending authorization owned by the delegate (agent).
    /// phantom T constrains which coin type this mandate covers.
    ///
    /// B-03: `store` ability is intentional — enables wrapping by higher-level
    /// protocols (AgentMandate, portfolio managers). Trade-off: `store` allows
    /// transfer via public_transfer, but transfer doesn't bypass revocation
    /// (the revocation registry uses the Mandate's UID, which is immutable).
    /// Removing `store` would break composability with no security benefit.
    public struct Mandate<phantom T> has key, store {
        id: UID,
        /// Human who authorized the spending
        delegator: address,
        /// Agent who can spend
        delegate: address,
        /// Maximum amount per transaction (base units)
        max_per_tx: u64,
        /// Lifetime spending cap (base units)
        max_total: u64,
        /// Running total of amount spent
        total_spent: u64,
        /// Expiry timestamp in milliseconds
        expires_at_ms: u64,
    }

    /// Shared revocation registry. One per delegator.
    /// Uses dynamic fields keyed by mandate ID for O(1) lookups.
    public struct RevocationRegistry has key {
        id: UID,
        owner: address,
    }

    /// Dynamic field key for revocation status
    public struct RevokedKey has copy, drop, store {
        mandate_id: ID,
    }

    // ══════════════════════════════════════════════════════════════
    // Mandate lifecycle
    // ══════════════════════════════════════════════════════════════

    /// Create a mandate and transfer it to the delegate.
    /// Called by the delegator (human).
    public fun create<T>(
        delegate: address,
        max_per_tx: u64,
        max_total: u64,
        expires_at_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Mandate<T> {
        assert!(expires_at_ms > clock.timestamp_ms(), EExpired);

        Mandate<T> {
            id: object::new(ctx),
            delegator: ctx.sender(),
            delegate,
            max_per_tx,
            max_total,
            total_spent: 0,
            expires_at_ms,
        }
    }

    /// Convenience entry: create mandate and transfer to delegate in one call.
    entry fun create_and_transfer<T>(
        delegate: address,
        max_per_tx: u64,
        max_total: u64,
        expires_at_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let mandate = create<T>(delegate, max_per_tx, max_total, expires_at_ms, clock, ctx);
        transfer::transfer(mandate, delegate);
    }

    // ══════════════════════════════════════════════════════════════
    // Spending
    // ══════════════════════════════════════════════════════════════

    /// Validate and debit a spending amount with mandatory revocation check.
    /// Called by the delegate in the same PTB as the payment transaction (atomic).
    ///
    /// Checks:
    ///   1. Mandate not revoked (via RevocationRegistry)
    ///   2. Caller is the delegate
    ///   3. Mandate not expired
    ///   4. Amount <= max_per_tx
    ///   5. total_spent + amount <= max_total
    ///
    /// RevocationRegistry is required — there is no unchecked path.
    /// If revocation is meaningless, delegators lose their kill switch.
    public fun validate_and_spend<T>(
        mandate: &mut Mandate<T>,
        amount: u64,
        registry: &RevocationRegistry,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        // C-2: Verify this is the delegator's own registry — prevents delegate passing
        // an empty registry they control to bypass the delegator's revocation.
        assert!(registry.owner == mandate.delegator, ENotDelegator);
        let key = RevokedKey { mandate_id: object::id(mandate) };
        assert!(!df::exists_(&registry.id, key), ERevoked);

        // Only the delegate can spend
        assert!(ctx.sender() == mandate.delegate, ENotDelegate);

        // Check expiry
        assert!(clock.timestamp_ms() < mandate.expires_at_ms, EExpired);

        // Per-transaction limit
        assert!(amount <= mandate.max_per_tx, EPerTxLimitExceeded);

        // Lifetime cap
        assert!(mandate.total_spent + amount <= mandate.max_total, ETotalLimitExceeded);

        // Debit
        mandate.total_spent = mandate.total_spent + amount;
    }

    // ══════════════════════════════════════════════════════════════
    // Revocation
    // ══════════════════════════════════════════════════════════════

    /// Create a revocation registry for a delegator.
    /// Each delegator needs one registry (shared object).
    entry fun create_registry(ctx: &mut TxContext) {
        let registry = RevocationRegistry {
            id: object::new(ctx),
            owner: ctx.sender(),
        };
        transfer::share_object(registry);
    }

    /// Revoke a mandate by adding its ID to the revocation registry.
    /// Only the delegator (registry owner) can revoke.
    #[allow(unused_type_parameter)]
    entry fun revoke<T>(
        registry: &mut RevocationRegistry,
        mandate_id: ID,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == registry.owner, ENotDelegator);
        let key = RevokedKey { mandate_id };
        if (!df::exists_(&registry.id, key)) {
            df::add(&mut registry.id, key, true);
        };
    }

    // ══════════════════════════════════════════════════════════════
    // Destruction (zombie object prevention)
    // ══════════════════════════════════════════════════════════════

    /// Destroy a mandate. Only the delegate (owner) can destroy.
    /// Use when a mandate is expired, revoked, or no longer needed.
    /// Prevents zombie objects accumulating on-chain.
    public fun destroy<T>(mandate: Mandate<T>, ctx: &TxContext) {
        assert!(ctx.sender() == mandate.delegate, ENotDelegate);
        let Mandate { id, delegator: _, delegate: _, max_per_tx: _, max_total: _, total_spent: _, expires_at_ms: _ } = mandate;
        object::delete(id);
    }

    /// Remove a revocation entry from the registry.
    /// Only the registry owner (delegator) can clean up.
    /// Call after the mandate object has been destroyed to free storage.
    entry fun cleanup_revocation(
        registry: &mut RevocationRegistry,
        mandate_id: ID,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == registry.owner, ENotDelegator);
        let key = RevokedKey { mandate_id };
        if (df::exists_(&registry.id, key)) {
            let _: bool = df::remove(&mut registry.id, key);
        };
    }

    // ══════════════════════════════════════════════════════════════
    // View functions
    // ══════════════════════════════════════════════════════════════

    public fun delegator<T>(m: &Mandate<T>): address { m.delegator }
    public fun delegate<T>(m: &Mandate<T>): address { m.delegate }
    public fun max_per_tx<T>(m: &Mandate<T>): u64 { m.max_per_tx }
    public fun max_total<T>(m: &Mandate<T>): u64 { m.max_total }
    public fun total_spent<T>(m: &Mandate<T>): u64 { m.total_spent }
    public fun expires_at_ms<T>(m: &Mandate<T>): u64 { m.expires_at_ms }
    public fun remaining<T>(m: &Mandate<T>): u64 { m.max_total - m.total_spent }

    /// Check if a mandate is expired (view only, no abort)
    public fun is_expired<T>(m: &Mandate<T>, clock: &Clock): bool {
        clock.timestamp_ms() >= m.expires_at_ms
    }

    /// Check if a mandate is revoked
    public fun is_revoked<T>(m: &Mandate<T>, registry: &RevocationRegistry): bool {
        let key = RevokedKey { mandate_id: object::id(m) };
        df::exists_(&registry.id, key)
    }

    /// Check if an arbitrary object ID is revoked in a registry.
    /// Used by agent_mandate module for cross-module revocation checks.
    public fun is_id_revoked(registry: &RevocationRegistry, mandate_id: ID): bool {
        let key = RevokedKey { mandate_id };
        df::exists_(&registry.id, key)
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun destroy_for_testing<T>(mandate: Mandate<T>) {
        let Mandate { id, delegator: _, delegate: _, max_per_tx: _, max_total: _, total_spent: _, expires_at_ms: _ } = mandate;
        object::delete(id);
    }

    #[test_only]
    public fun create_registry_for_testing(ctx: &mut TxContext): RevocationRegistry {
        RevocationRegistry {
            id: object::new(ctx),
            owner: ctx.sender(),
        }
    }

    #[test_only]
    public fun destroy_registry_for_testing(registry: RevocationRegistry) {
        let RevocationRegistry { id, owner: _ } = registry;
        object::delete(id);
    }
}
