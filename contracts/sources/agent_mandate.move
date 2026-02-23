/// SweeFi AgentMandate — tiered spending authorization with periodic caps
///
/// Extends the basic Mandate concept with:
///   - Mandate levels (L0-L3): progressive autonomy from read-only to autonomous
///   - Daily spending cap: lazy-reset every 24h
///   - Weekly spending cap: lazy-reset every 7d
///   - Level upgrade: delegator can promote an agent's mandate over time
///
/// Lazy reset pattern: Move has no cron. Daily/weekly counters reset on the
/// first spend after the period boundary. This is the same pattern as
/// prepaid.move's withdrawal timing — check Clock, reset if past deadline.
///
/// Uses the same RevocationRegistry from sweefi::mandate for revocation.
///
/// Error codes: 500-series (mandate=400, agent_mandate=500)
#[allow(lint(self_transfer), unused_const)]
module sweefi::agent_mandate {
    use sui::clock::Clock;
    use sweefi::mandate::{ Self as mandate, RevocationRegistry };

    // ══════════════════════════════════════════════════════════════
    // Constants
    // ══════════════════════════════════════════════════════════════

    /// Milliseconds in one day (24 * 60 * 60 * 1000)
    const MS_PER_DAY: u64 = 86_400_000;
    /// Milliseconds in one week (7 * 24 * 60 * 60 * 1000)
    const MS_PER_WEEK: u64 = 604_800_000;

    // Mandate levels
    const LEVEL_READ_ONLY: u8 = 0;   // L0: cron/read-only (no spending)
    const LEVEL_MONITOR: u8 = 1;      // L1: monitor + alert (no spending)
    const LEVEL_CAPPED: u8 = 2;       // L2: capped purchasing (spends within caps)
    const LEVEL_AUTONOMOUS: u8 = 3;   // L3: autonomous (spends with post-notify)

    // ══════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════

    const ENotDelegate: u64 = 500;
    const EExpired: u64 = 501;
    const EPerTxLimitExceeded: u64 = 502;
    const ETotalLimitExceeded: u64 = 503;
    const ENotDelegator: u64 = 504;
    const ERevoked: u64 = 505;
    const EDailyLimitExceeded: u64 = 506;
    const EWeeklyLimitExceeded: u64 = 507;
    const EInvalidLevel: u64 = 508;
    const ELevelNotAuthorized: u64 = 509;
    const ECannotDowngrade: u64 = 510;

    // ══════════════════════════════════════════════════════════════
    // Structs
    // ══════════════════════════════════════════════════════════════

    /// Agent spending authorization with tiered levels and periodic caps.
    /// Owned by the delegate (agent) for fast single-owner transactions.
    public struct AgentMandate<phantom T> has key, store {
        id: UID,
        delegator: address,     // human who created and can upgrade/revoke this mandate
        delegate: address,      // agent who may call validate_and_spend

        /// Mandate level: 0=L0 (read-only), 1=L1 (monitor), 2=L2 (capped), 3=L3 (autonomous)
        /// Only L2+ can spend. Level can only increase (upgrade_level); downgrade = revoke + recreate.
        level: u8,

        max_per_tx: u64,            // ceiling per individual spend (base units)

        daily_limit: u64,           // daily spending ceiling; 0 = no daily limit
        daily_spent: u64,           // amount spent in the current daily period
        last_daily_reset_ms: u64,   // when daily_spent was last zeroed; initialized to creation time, not epoch 0

        weekly_limit: u64,          // weekly spending ceiling; 0 = no weekly limit
        weekly_spent: u64,          // amount spent in the current weekly period
        last_weekly_reset_ms: u64,  // when weekly_spent was last zeroed; initialized to creation time, not epoch 0

        max_total: u64,             // lifetime ceiling across all spends (base units)
        total_spent: u64,           // cumulative sum; never decreases; invariant: total_spent <= max_total

        expires_at_ms: Option<u64>, // None = permanent (revocation-only control), Some(t) = expires at t
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    /// Emitted when an agent mandate is created
    public struct AgentMandateCreated has copy, drop {
        mandate_id: ID,
        delegator: address,
        delegate: address,
        level: u8,
        max_per_tx: u64,
        daily_limit: u64,
        weekly_limit: u64,
        max_total: u64,
        expires_at_ms: Option<u64>,
    }

    /// Emitted when a mandate level is upgraded
    public struct MandateLevelUpgraded has copy, drop {
        mandate_id: ID,
        old_level: u8,
        new_level: u8,
        delegator: address,
    }

    /// Emitted when spending caps are updated by the delegator
    public struct CapsUpdated has copy, drop {
        mandate_id: ID,
        delegator: address,
        new_max_per_tx: u64,
        new_daily_limit: u64,
        new_weekly_limit: u64,
        new_max_total: u64,
    }

    /// Emitted on each spend for audit trail
    public struct AgentSpend has copy, drop {
        mandate_id: ID,
        delegate: address,
        amount: u64,
        daily_spent: u64,
        weekly_spent: u64,
        total_spent: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Mandate lifecycle
    // ══════════════════════════════════════════════════════════════

    /// Create an agent mandate. Called by the delegator (human).
    /// Level must be 0-3. For L0/L1, spending caps can be 0.
    public fun create<T>(
        delegate: address,
        level: u8,
        max_per_tx: u64,
        daily_limit: u64,
        weekly_limit: u64,
        max_total: u64,
        expires_at_ms: Option<u64>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): AgentMandate<T> {
        // If an expiry is provided, it must be in the future
        if (expires_at_ms.is_some()) {
            assert!(*expires_at_ms.borrow() > clock.timestamp_ms(), EExpired);
        };
        assert!(level <= LEVEL_AUTONOMOUS, EInvalidLevel);

        let now = clock.timestamp_ms();
        let mandate = AgentMandate<T> {
            id: object::new(ctx),
            delegator: ctx.sender(),
            delegate,
            level,
            max_per_tx,
            daily_limit,
            daily_spent: 0,
            // Initialize to now, not epoch 0. If set to 0, the first spend could
            // trigger a lazy reset against a window stretching back to the Unix epoch,
            // allowing the full daily_limit to appear "fresh" regardless of actual age.
            last_daily_reset_ms: now,
            weekly_limit,
            weekly_spent: 0,
            last_weekly_reset_ms: now,
            max_total,
            total_spent: 0,
            expires_at_ms,
        };

        sui::event::emit(AgentMandateCreated {
            mandate_id: object::id(&mandate),
            delegator: ctx.sender(),
            delegate,
            level,
            max_per_tx,
            daily_limit,
            weekly_limit,
            max_total,
            expires_at_ms,
        });

        mandate
    }

    /// Convenience entry: create and transfer to delegate in one call.
    entry fun create_and_transfer<T>(
        delegate: address,
        level: u8,
        max_per_tx: u64,
        daily_limit: u64,
        weekly_limit: u64,
        max_total: u64,
        expires_at_ms: Option<u64>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let mandate = create<T>(
            delegate, level, max_per_tx, daily_limit,
            weekly_limit, max_total, expires_at_ms, clock, ctx,
        );
        transfer::transfer(mandate, delegate);
    }

    // ══════════════════════════════════════════════════════════════
    // Spending
    // ══════════════════════════════════════════════════════════════

    /// Validate and debit a spending amount with mandatory revocation check.
    /// Called by the delegate (agent) in the same PTB as the payment transaction.
    ///
    /// RevocationRegistry is required — there is no unchecked path.
    /// If revocation is meaningless, delegators lose their kill switch.
    ///
    /// Checks (in order):
    ///   1. Mandate not revoked (via RevocationRegistry)
    ///   2. Caller is the delegate
    ///   3. Mandate not expired
    ///   4. Level >= L2 (only L2+ can spend)
    ///   5. Lazy-reset daily counter if 24h+ have elapsed
    ///   6. Lazy-reset weekly counter if 7d+ have elapsed
    ///   7. amount <= max_per_tx
    ///   8. daily_spent + amount <= daily_limit (if daily_limit > 0)
    ///   9. weekly_spent + amount <= weekly_limit (if weekly_limit > 0)
    ///  10. total_spent + amount <= max_total
    public fun validate_and_spend<T>(
        mandate: &mut AgentMandate<T>,
        amount: u64,
        registry: &RevocationRegistry,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        // 1. SECURITY (H-1 equivalent): Verify registry belongs to this mandate's delegator.
        //    mandate::is_id_revoked() does NOT check registry ownership. Without this guard,
        //    a rogue delegate could pass an empty registry they control to bypass revocation.
        assert!(mandate::registry_owner(registry) == mandate.delegator, ENotDelegator);
        assert!(!mandate::is_id_revoked(registry, object::id(mandate)), ERevoked);

        let now = clock.timestamp_ms();

        // 2. Only the delegate can spend
        assert!(ctx.sender() == mandate.delegate, ENotDelegate);

        // 3. Check expiry (None = never expires)
        if (mandate.expires_at_ms.is_some()) {
            assert!(now < *mandate.expires_at_ms.borrow(), EExpired);
        };

        // 4. Level check — only L2+ can spend
        assert!(mandate.level >= LEVEL_CAPPED, ELevelNotAuthorized);

        // 5. Lazy daily reset
        if (now - mandate.last_daily_reset_ms >= MS_PER_DAY) {
            mandate.daily_spent = 0;
            mandate.last_daily_reset_ms = now;
        };

        // 6. Lazy weekly reset
        if (now - mandate.last_weekly_reset_ms >= MS_PER_WEEK) {
            mandate.weekly_spent = 0;
            mandate.last_weekly_reset_ms = now;
        };

        // 7. Per-transaction limit
        assert!(amount <= mandate.max_per_tx, EPerTxLimitExceeded);

        // 8. Daily limit (0 = no daily limit)
        if (mandate.daily_limit > 0) {
            assert!(mandate.daily_spent + amount <= mandate.daily_limit, EDailyLimitExceeded);
        };

        // 9. Weekly limit (0 = no weekly limit)
        if (mandate.weekly_limit > 0) {
            assert!(mandate.weekly_spent + amount <= mandate.weekly_limit, EWeeklyLimitExceeded);
        };

        // 10. Lifetime cap
        assert!(mandate.total_spent + amount <= mandate.max_total, ETotalLimitExceeded);

        // Debit all counters
        mandate.daily_spent = mandate.daily_spent + amount;
        mandate.weekly_spent = mandate.weekly_spent + amount;
        mandate.total_spent = mandate.total_spent + amount;

        // Emit audit event
        sui::event::emit(AgentSpend {
            mandate_id: object::id(mandate),
            delegate: mandate.delegate,
            amount,
            daily_spent: mandate.daily_spent,
            weekly_spent: mandate.weekly_spent,
            total_spent: mandate.total_spent,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Level management
    // ══════════════════════════════════════════════════════════════

    /// Upgrade a mandate's level. Only the delegator can upgrade.
    /// Cannot downgrade — use revoke + recreate for that.
    /// One-way constraint prevents an agent from briefly self-downgrading to L1
    /// (bypassing spend tracking) and then upgrading back.
    entry fun upgrade_level<T>(
        mandate: &mut AgentMandate<T>,
        new_level: u8,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == mandate.delegator, ENotDelegator);
        assert!(new_level <= LEVEL_AUTONOMOUS, EInvalidLevel);
        assert!(new_level > mandate.level, ECannotDowngrade);

        let old_level = mandate.level;
        mandate.level = new_level;

        sui::event::emit(MandateLevelUpgraded {
            mandate_id: object::id(mandate),
            old_level,
            new_level,
            delegator: mandate.delegator,
        });
    }

    /// Update spending caps. Only the delegator can modify caps.
    /// Useful when upgrading from L1→L2 (need to set spending caps).
    entry fun update_caps<T>(
        mandate: &mut AgentMandate<T>,
        new_max_per_tx: u64,
        new_daily_limit: u64,
        new_weekly_limit: u64,
        new_max_total: u64,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == mandate.delegator, ENotDelegator);
        // F-06: Prevent setting a limit below what's already been spent in the current period.
        // This would instantly freeze spending until the next period reset, surprising delegators.
        // (0 = no limit, so bypass the check when the new limit means "unlimited")
        assert!(new_daily_limit == 0 || new_daily_limit >= mandate.daily_spent, EDailyLimitExceeded);
        assert!(new_weekly_limit == 0 || new_weekly_limit >= mandate.weekly_spent, EWeeklyLimitExceeded);
        mandate.max_per_tx = new_max_per_tx;
        mandate.daily_limit = new_daily_limit;
        mandate.weekly_limit = new_weekly_limit;
        mandate.max_total = new_max_total;

        sui::event::emit(CapsUpdated {
            mandate_id: object::id(mandate),
            delegator: mandate.delegator,
            new_max_per_tx,
            new_daily_limit,
            new_weekly_limit,
            new_max_total,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Destruction (zombie object prevention)
    // ══════════════════════════════════════════════════════════════

    /// Destroy an agent mandate. Only the delegate (owner) can destroy.
    /// Use when a mandate is expired, revoked, or no longer needed.
    /// Prevents zombie objects accumulating on-chain.
    public fun destroy<T>(mandate: AgentMandate<T>, ctx: &TxContext) {
        assert!(ctx.sender() == mandate.delegate, ENotDelegate);
        let AgentMandate {
            id, delegator: _, delegate: _, level: _,
            max_per_tx: _, daily_limit: _, daily_spent: _,
            last_daily_reset_ms: _, weekly_limit: _, weekly_spent: _,
            last_weekly_reset_ms: _, max_total: _, total_spent: _,
            expires_at_ms: _,
        } = mandate;
        object::delete(id);
    }

    /// Destroy an agent mandate held by any address, regardless of delegate field.
    /// AgentMandate holds no funds — any holder can destroy it.
    ///
    /// Use when an AgentMandate was accidentally transferred to a non-delegate
    /// address and became a zombie (the holder cannot use destroy() because the
    /// delegate check fails). Security: spending remains delegate-only
    /// (validate_and_spend checks mandate.delegate). Destroying a held mandate
    /// does not transfer any spending rights.
    public fun destroy_held<T>(mandate: AgentMandate<T>) {
        let AgentMandate {
            id, delegator: _, delegate: _, level: _,
            max_per_tx: _, daily_limit: _, daily_spent: _,
            last_daily_reset_ms: _, weekly_limit: _, weekly_spent: _,
            last_weekly_reset_ms: _, max_total: _, total_spent: _,
            expires_at_ms: _,
        } = mandate;
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // View functions
    // ══════════════════════════════════════════════════════════════

    public fun delegator<T>(m: &AgentMandate<T>): address { m.delegator }
    public fun delegate<T>(m: &AgentMandate<T>): address { m.delegate }
    public fun level<T>(m: &AgentMandate<T>): u8 { m.level }
    public fun max_per_tx<T>(m: &AgentMandate<T>): u64 { m.max_per_tx }
    public fun daily_limit<T>(m: &AgentMandate<T>): u64 { m.daily_limit }
    public fun daily_spent<T>(m: &AgentMandate<T>): u64 { m.daily_spent }
    public fun weekly_limit<T>(m: &AgentMandate<T>): u64 { m.weekly_limit }
    public fun weekly_spent<T>(m: &AgentMandate<T>): u64 { m.weekly_spent }
    public fun max_total<T>(m: &AgentMandate<T>): u64 { m.max_total }
    public fun total_spent<T>(m: &AgentMandate<T>): u64 { m.total_spent }
    public fun expires_at_ms<T>(m: &AgentMandate<T>): Option<u64> { m.expires_at_ms }
    /// Remaining lifetime budget. Saturates to 0 if caps were lowered
    /// below total_spent via update_caps (prevents underflow abort).
    public fun remaining<T>(m: &AgentMandate<T>): u64 {
        if (m.total_spent >= m.max_total) 0
        else m.max_total - m.total_spent
    }

    public fun daily_remaining<T>(m: &AgentMandate<T>): u64 {
        if (m.daily_limit == 0) {
            if (m.total_spent >= m.max_total) return 0;
            return m.max_total - m.total_spent
        };
        if (m.daily_spent >= m.daily_limit) 0
        else m.daily_limit - m.daily_spent
    }

    public fun weekly_remaining<T>(m: &AgentMandate<T>): u64 {
        if (m.weekly_limit == 0) {
            if (m.total_spent >= m.max_total) return 0;
            return m.max_total - m.total_spent
        };
        if (m.weekly_spent >= m.weekly_limit) 0
        else m.weekly_limit - m.weekly_spent
    }

    /// None = never expires → always returns false.
    public fun is_expired<T>(m: &AgentMandate<T>, clock: &Clock): bool {
        if (m.expires_at_ms.is_some()) {
            clock.timestamp_ms() >= *m.expires_at_ms.borrow()
        } else {
            false
        }
    }

    public fun is_revoked<T>(m: &AgentMandate<T>, registry: &RevocationRegistry): bool {
        mandate::is_id_revoked(registry, object::id(m))
    }

    /// Check if the mandate can spend (level >= L2, not expired)
    public fun can_spend<T>(m: &AgentMandate<T>, clock: &Clock): bool {
        m.level >= LEVEL_CAPPED && !is_expired(m, clock)
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun destroy_for_testing<T>(mandate: AgentMandate<T>) {
        let AgentMandate {
            id, delegator: _, delegate: _, level: _,
            max_per_tx: _, daily_limit: _, daily_spent: _,
            last_daily_reset_ms: _, weekly_limit: _, weekly_spent: _,
            last_weekly_reset_ms: _, max_total: _, total_spent: _,
            expires_at_ms: _,
        } = mandate;
        object::delete(id);
    }
}
