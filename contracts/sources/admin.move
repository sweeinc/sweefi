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
    use sui::clock::Clock;

    // ══════════════════════════════════════════════════════════════
    // Error codes (500-series)
    // ══════════════════════════════════════════════════════════════

    const EAlreadyPaused: u64 = 500;
    const ENotPaused: u64 = 501;
    const EProtocolPaused: u64 = 502;
    const EAutoUnpauseNotReady: u64 = 503;

    // ══════════════════════════════════════════════════════════════
    // Constants
    // ══════════════════════════════════════════════════════════════

    /// Auto-unpause window: 14 days in milliseconds.
    /// If the admin key is lost while paused, the protocol self-heals
    /// after this window — converting key loss into decentralization.
    const AUTO_UNPAUSE_WINDOW_MS: u64 = 1_209_600_000;

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
    public struct ProtocolState has key {
        id: UID,
        paused: bool,        // true = only withdrawals allowed; new deposits/creations blocked
        paused_at_ms: u64,   // timestamp when pause was activated (0 when not paused)
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

    public struct ProtocolAutoUnpaused has copy, drop {
        triggered_by: address,
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
            ProtocolState { id: object::new(ctx), paused: false, paused_at_ms: 0 },
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
    ///
    /// Time-aware: if the auto-unpause window has elapsed, the protocol is
    /// effectively unpaused even if `state.paused` is still true. This means
    /// creation functions self-heal after 14 days without anyone calling
    /// `auto_unpause()` explicitly.
    public fun assert_not_paused(state: &ProtocolState, clock: &Clock) {
        assert!(
            !(state.paused && clock.timestamp_ms() < state.paused_at_ms + AUTO_UNPAUSE_WINDOW_MS),
            EProtocolPaused,
        );
    }

    // ══════════════════════════════════════════════════════════════
    // Admin operations
    // ══════════════════════════════════════════════════════════════

    /// Pause the protocol. Prevents new stream/escrow creation.
    /// Existing streams/escrows and all withdrawals are unaffected.
    /// `_cap` is unused beyond proving capability — the underscore is intentional
    /// (Move's capability pattern: object presence in a tx is the authorization).
    ///
    /// Records the pause timestamp for auto-unpause. The protocol will
    /// self-heal after AUTO_UNPAUSE_WINDOW_MS (14 days) if the admin key
    /// is lost. Re-pausing resets the timer.
    public entry fun pause(
        _cap: &AdminCap,
        state: &mut ProtocolState,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(!state.paused, EAlreadyPaused);
        state.paused = true;
        state.paused_at_ms = clock.timestamp_ms();
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
        state.paused_at_ms = 0;
        event::emit(ProtocolUnpaused { unpaused_by: ctx.sender() });
    }

    /// Permissionless auto-unpause after the safety window elapses.
    /// Anyone can call this — same pattern as permissionless escrow refund.
    /// Converts admin key loss into graceful decentralization.
    public entry fun auto_unpause(
        state: &mut ProtocolState,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(state.paused, ENotPaused);
        assert!(
            clock.timestamp_ms() >= state.paused_at_ms + AUTO_UNPAUSE_WINDOW_MS,
            EAutoUnpauseNotReady,
        );
        state.paused = false;
        state.paused_at_ms = 0;
        event::emit(ProtocolAutoUnpaused { triggered_by: ctx.sender() });
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
            ProtocolState { id: object::new(ctx), paused: false, paused_at_ms: 0 },
        )
    }

    #[test_only]
    public fun create_state_for_testing(ctx: &mut TxContext): ProtocolState {
        ProtocolState { id: object::new(ctx), paused: false, paused_at_ms: 0 }
    }

    #[test_only]
    public fun destroy_state_for_testing(state: ProtocolState) {
        let ProtocolState { id, paused: _, paused_at_ms: _ } = state;
        object::delete(id);
    }

    #[test_only]
    public fun destroy_cap_for_testing(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }
}
