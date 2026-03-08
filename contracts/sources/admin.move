/// SweeFi Admin — Emergency pause circuit breaker
///
/// Every production Sui DeFi protocol (DeepBook, Cetus, Turbos, Aftermath)
/// ships AdminCap with emergency pause. Without it, a critical bug post-mainnet
/// means permanently frozen/draining funds with zero recourse.
///
/// Architecture:
///   - AdminCap (owned, key+store): Authorization token for admin operations.
///     `store` enables future multisig wrapping without contract upgrade.
///   - ProtocolState (shared): Global pause flag. Checked by stream/escrow
///     creation functions only (two-tier guard — see ADR-004).
///
/// Two-tier guard design:
///   - Stream + Escrow + Prepaid + Identity: Guard creation/deposit functions only
///     (stop new money entering a broken system)
///   - Payment + Seal: No guard (preserve owned-object fast path)
///   - User withdrawals: Never guarded (users must always exit)
///
/// Lifecycle: deploy → AdminCap to deployer → (optional) wrap in multisig
///            → burn_admin_cap when protocol is trustless
///
/// Error codes: 500-series (payment=0, stream=100, escrow=200, seal=300, mandate=400, admin=500)
#[allow(lint(self_transfer, public_entry))]
module sweefi::admin {
    use sui::event;

    // ══════════════════════════════════════════════════════════════
    // Error codes (500-series)
    // ══════════════════════════════════════════════════════════════

    const EAlreadyPaused: u64 = 500;
    const ENotPaused: u64 = 501;
    const EProtocolPaused: u64 = 502;

    // ══════════════════════════════════════════════════════════════
    // Structs
    // ══════════════════════════════════════════════════════════════

    /// Authorization token for admin operations.
    /// key + store: `store` enables wrapping in a multisig module without upgrade.
    /// Intentionally has no fields beyond `id` — its presence in a transaction IS the proof.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Global protocol state — shared object.
    /// No `store` ability — only this module can share it, preventing shadow registries.
    /// Currently just a pause flag. Granularity can be added later if needed.
    public struct ProtocolState has key {
        id: UID,
        paused: bool,   // true = only withdrawals allowed; new deposits/creations blocked
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct ProtocolPaused has copy, drop {
        paused_by: address,
    }

    public struct ProtocolUnpaused has copy, drop {
        unpaused_by: address,
    }

    public struct AdminCapBurned has copy, drop {
        burned_by: address,
    }

    // ══════════════════════════════════════════════════════════════
    // Init — creates AdminCap + ProtocolState on publish
    // ══════════════════════════════════════════════════════════════

    // Both objects are created atomically in the same transaction, so there is
    // no window where ProtocolState exists but the AdminCap hasn't been delivered.
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            ctx.sender(),
        );
        transfer::share_object(
            ProtocolState { id: object::new(ctx), paused: false },
        );
    }

    // ══════════════════════════════════════════════════════════════
    // Read functions (used by stream/escrow as guards)
    // ══════════════════════════════════════════════════════════════

    /// Check if the protocol is paused.
    public fun is_paused(state: &ProtocolState): bool {
        state.paused
    }

    /// Convenience: abort if paused. One-liner guard for guarded functions.
    /// Uses EProtocolPaused (502), distinct from EAlreadyPaused (500) which is
    /// for the admin's double-pause attempt in pause().
    public fun assert_not_paused(state: &ProtocolState) {
        assert!(!state.paused, EProtocolPaused);
    }

    // ══════════════════════════════════════════════════════════════
    // Admin operations
    // ══════════════════════════════════════════════════════════════

    /// Pause the protocol. Prevents new stream/escrow creation.
    /// Existing streams/escrows and all withdrawals are unaffected.
    /// `_cap` is unused beyond proving capability — the underscore is intentional
    /// (Move's capability pattern: object presence in a tx is the authorization).
    public entry fun pause(
        _cap: &AdminCap,
        state: &mut ProtocolState,
        ctx: &TxContext,
    ) {
        assert!(!state.paused, EAlreadyPaused);
        state.paused = true;
        event::emit(ProtocolPaused { paused_by: ctx.sender() });
    }

    /// Unpause the protocol. Resumes normal operation.
    public entry fun unpause(
        _cap: &AdminCap,
        state: &mut ProtocolState,
        ctx: &TxContext,
    ) {
        assert!(state.paused, ENotPaused);
        state.paused = false;
        event::emit(ProtocolUnpaused { unpaused_by: ctx.sender() });
    }

    /// Irrevocably burn the AdminCap — protocol becomes fully trustless.
    /// After burn, no one can pause/unpause. This is a one-way door.
    ///
    /// Requires ProtocolState to ensure the protocol is unpaused before burning.
    /// Burning while paused would freeze new operations permanently with no recovery.
    public entry fun burn_admin_cap(
        cap: AdminCap,
        state: &ProtocolState,
        ctx: &TxContext,
    ) {
        assert!(!state.paused, EAlreadyPaused);
        let AdminCap { id } = cap;
        event::emit(AdminCapBurned { burned_by: ctx.sender() });
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun create_for_testing(ctx: &mut TxContext): (AdminCap, ProtocolState) {
        (
            AdminCap { id: object::new(ctx) },
            ProtocolState { id: object::new(ctx), paused: false },
        )
    }

    #[test_only]
    public fun create_state_for_testing(ctx: &mut TxContext): ProtocolState {
        ProtocolState { id: object::new(ctx), paused: false }
    }

    #[test_only]
    public fun destroy_state_for_testing(state: ProtocolState) {
        let ProtocolState { id, paused: _ } = state;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_cap_for_testing(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }
}
