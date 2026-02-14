/// SweePay Streaming Micropayments — the Moonshot star
///
/// "The first protocol where an agent pays $0.0003/second for inference,
/// with on-chain budget caps, automatic settlement, and zero pre-funding."
///
/// The Airbnb of compute: anyone can sell spare GPU cycles, paid per-second on-chain.
///
/// Design decisions:
///   - StreamingMeter is a SHARED object (not owned). Both payer and recipient
///     need to interact with it. Streams are long-running bilateral relationships
///     with infrequent claims — NOT on the hot payment path. Council guidance
///     "avoid shared objects on hot path" does not apply here.
///   - Balance<T> for internal fund storage (not Coin<T>)
///   - rate_per_second for human-readable rates, ms precision internally
///   - Overflow-safe: all rate * time calculations use u128 intermediate
///   - Fee splitting on claims (same model as payment.move)
module sweepay::stream {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::event;
    use sui::clock::Clock;
    use sui::dynamic_field;
    use std::type_name;
    use std::ascii;
    use sweepay::admin;

    // ══════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════

    const ENotPayer: u64 = 100;
    const ENotRecipient: u64 = 101;
    const EStreamInactive: u64 = 102;
    const EStreamAlreadyActive: u64 = 103;
    const EZeroRate: u64 = 104;
    const EZeroDeposit: u64 = 105;
    const ENothingToClaim: u64 = 106;
    const EInvalidFeeBps: u64 = 107;
    const EBudgetCapExceeded: u64 = 108;
    const ETimeoutNotReached: u64 = 109;
    const ETimeoutTooShort: u64 = 110;

    /// Default recipient close timeout: 7 days in ms (7 * 24 * 60 * 60 * 1000).
    /// Used when create() is called without explicit timeout.
    const RECIPIENT_CLOSE_TIMEOUT_MS: u64 = 604_800_000;

    /// Minimum allowed recipient close timeout: 1 day in ms.
    /// Prevents payer from setting a trivially short timeout that
    /// makes recipient_close() useless as a safety mechanism.
    const MIN_RECIPIENT_CLOSE_TIMEOUT_MS: u64 = 86_400_000;

    /// Dynamic field key for per-stream recipient close timeout.
    /// Stored on the StreamingMeter UID via dynamic_field.
    /// Absence means "use RECIPIENT_CLOSE_TIMEOUT_MS default."
    public struct TimeoutKey has copy, drop, store {}

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Streaming payment meter — shared object.
    /// Payer deposits funds, recipient claims accrued amount over time.
    /// phantom T: the coin type (USDC, SUI, suiUSDe, etc.)
    /// NOTE: budget_cap tracks GROSS claimed (including fees). With 5% fees
    /// and budget_cap=100k, recipient receives 95k. This is the payer's total
    /// outflow cap, not the recipient's total inflow cap.
    public struct StreamingMeter<phantom T> has key {
        id: UID,
        payer: address,
        recipient: address,
        balance: Balance<T>,
        rate_per_second: u64,       // tokens per second (human-readable unit)
        budget_cap: u64,            // max total spend (gross, including fees)
        total_claimed: u64,         // cumulative gross claimed by recipient
        last_claim_ms: u64,         // Clock timestamp of last claim (ms)
        created_at_ms: u64,         // Clock timestamp of creation (ms)
        active: bool,               // pause/resume control
        paused_at_ms: u64,          // Clock timestamp when paused (0 if not paused or already claimed)
        fee_bps: u64,               // facilitator fee on claims (basis points)
        fee_recipient: address,     // where fees go
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct StreamCreated has copy, drop {
        meter_id: ID,
        payer: address,
        recipient: address,
        deposit: u64,
        rate_per_second: u64,
        budget_cap: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct StreamClaimed has copy, drop {
        meter_id: ID,
        recipient: address,
        amount: u64,
        fee_amount: u64,
        total_claimed: u64,
        timestamp_ms: u64,
    }

    public struct StreamPaused has copy, drop {
        meter_id: ID,
        payer: address,
        total_claimed: u64,
        timestamp_ms: u64,
    }

    public struct StreamResumed has copy, drop {
        meter_id: ID,
        payer: address,
        timestamp_ms: u64,
    }

    public struct StreamClosed has copy, drop {
        meter_id: ID,
        payer: address,
        total_claimed: u64,
        refunded: u64,
        timestamp_ms: u64,
    }

    public struct StreamRecipientClosed has copy, drop {
        meter_id: ID,
        recipient: address,
        payer: address,
        claimed: u64,
        refunded: u64,
        timestamp_ms: u64,
    }

    public struct StreamTopUp has copy, drop {
        meter_id: ID,
        payer: address,
        amount: u64,
        new_balance: u64,
        timestamp_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Create
    // ══════════════════════════════════════════════════════════════

    /// Open a streaming payment channel.
    /// Payer deposits funds and sets the rate. The meter starts immediately.
    /// The StreamingMeter is shared — both payer and recipient can interact.
    public fun create<T>(
        deposit: Coin<T>,
        recipient: address,
        rate_per_second: u64,
        budget_cap: u64,
        fee_bps: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        let deposit_value = deposit.value();
        assert!(deposit_value > 0, EZeroDeposit);
        assert!(rate_per_second > 0, EZeroRate);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(budget_cap > 0, EBudgetCapExceeded);

        let now_ms = clock.timestamp_ms();
        let payer = ctx.sender();

        let meter = StreamingMeter<T> {
            id: object::new(ctx),
            payer,
            recipient,
            balance: coin::into_balance(deposit),
            rate_per_second,
            budget_cap,
            total_claimed: 0,
            last_claim_ms: now_ms,
            created_at_ms: now_ms,
            active: true,
            paused_at_ms: 0,
            fee_bps,
            fee_recipient,
        };

        event::emit(StreamCreated {
            meter_id: object::id(&meter),
            payer,
            recipient,
            deposit: deposit_value,
            rate_per_second,
            budget_cap,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(meter);
    }

    /// Open a streaming payment channel with a custom recipient close timeout.
    /// Same as create(), but allows the payer to set how long the stream must
    /// be inactive before the recipient can force-close it.
    /// Minimum timeout: 1 day (MIN_RECIPIENT_CLOSE_TIMEOUT_MS).
    public fun create_with_timeout<T>(
        deposit: Coin<T>,
        recipient: address,
        rate_per_second: u64,
        budget_cap: u64,
        fee_bps: u64,
        fee_recipient: address,
        recipient_close_timeout_ms: u64,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        let deposit_value = deposit.value();
        assert!(deposit_value > 0, EZeroDeposit);
        assert!(rate_per_second > 0, EZeroRate);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(budget_cap > 0, EBudgetCapExceeded);
        assert!(recipient_close_timeout_ms >= MIN_RECIPIENT_CLOSE_TIMEOUT_MS, ETimeoutTooShort);

        let now_ms = clock.timestamp_ms();
        let payer = ctx.sender();

        let mut meter = StreamingMeter<T> {
            id: object::new(ctx),
            payer,
            recipient,
            balance: coin::into_balance(deposit),
            rate_per_second,
            budget_cap,
            total_claimed: 0,
            last_claim_ms: now_ms,
            created_at_ms: now_ms,
            active: true,
            paused_at_ms: 0,
            fee_bps,
            fee_recipient,
        };

        // Store custom timeout as dynamic field on the UID.
        // No struct change needed — backward compatible with existing objects.
        dynamic_field::add(&mut meter.id, TimeoutKey {}, recipient_close_timeout_ms);

        event::emit(StreamCreated {
            meter_id: object::id(&meter),
            payer,
            recipient,
            deposit: deposit_value,
            rate_per_second,
            budget_cap,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(meter);
    }

    // ══════════════════════════════════════════════════════════════
    // Claim (recipient)
    // ══════════════════════════════════════════════════════════════

    /// Recipient claims accrued funds based on elapsed time.
    /// Fees are split to fee_recipient. Remaining goes to recipient.
    /// If budget_cap is reached, stream auto-deactivates.
    /// Can claim pre-pause accrual even when paused (paused_at_ms > 0).
    public fun claim<T>(
        meter: &mut StreamingMeter<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == meter.recipient, ENotRecipient);

        let now_ms = clock.timestamp_ms();

        // Determine accrual endpoint:
        // - Active stream: accrue up to now
        // - Paused with unclaimed accrual: accrue up to pause time
        // - Inactive with no pending accrual: nothing to claim
        let accrued = if (meter.active) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                now_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else if (meter.paused_at_ms > 0) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                meter.paused_at_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else {
            0
        };

        // Cap at actual balance
        let claimable = if (accrued > meter.balance.value()) {
            meter.balance.value()
        } else {
            accrued
        };

        assert!(claimable > 0, ENothingToClaim);

        // Calculate fee (overflow-safe)
        let fee_amount = calculate_fee(claimable, meter.fee_bps);
        let recipient_amount = claimable - fee_amount;

        // Transfer fee
        if (fee_amount > 0) {
            let fee_balance = meter.balance.split(fee_amount);
            transfer::public_transfer(
                coin::from_balance(fee_balance, ctx),
                meter.fee_recipient,
            );
        };

        // Transfer to recipient
        if (recipient_amount > 0) {
            let claim_balance = meter.balance.split(recipient_amount);
            transfer::public_transfer(
                coin::from_balance(claim_balance, ctx),
                meter.recipient,
            );
        };

        // Update meter state
        meter.total_claimed = meter.total_claimed + claimable;

        if (meter.active) {
            meter.last_claim_ms = now_ms;
        } else {
            // Claimed the paused accrual — clear paused_at_ms to prevent double-claim
            meter.paused_at_ms = 0;
        };

        // Auto-deactivate if budget exhausted
        if (meter.total_claimed >= meter.budget_cap || meter.balance.value() == 0) {
            meter.active = false;
        };

        event::emit(StreamClaimed {
            meter_id: object::id(meter),
            recipient: meter.recipient,
            amount: claimable,
            fee_amount,
            total_claimed: meter.total_claimed,
            timestamp_ms: now_ms,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Pause / Resume (payer)
    // ══════════════════════════════════════════════════════════════

    /// Payer pauses the stream. No further accrual until resumed.
    /// Any already-accrued amount remains claimable via claim() while paused.
    public fun pause<T>(
        meter: &mut StreamingMeter<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == meter.payer, ENotPayer);
        assert!(meter.active, EStreamInactive);

        let now_ms = clock.timestamp_ms();

        // Snapshot the pause time — accrual from last_claim_ms to paused_at_ms
        // remains claimable. We DON'T update last_claim_ms here.
        meter.active = false;
        meter.paused_at_ms = now_ms;

        event::emit(StreamPaused {
            meter_id: object::id(meter),
            payer: meter.payer,
            total_claimed: meter.total_claimed,
            timestamp_ms: now_ms,
        });
    }

    /// Payer resumes a paused stream. Accrual restarts from now,
    /// but any unclaimed pre-pause accrual is PRESERVED via time-shifting.
    ///
    /// Security fix: without preservation, a payer could atomically
    /// pause() → resume() → close() in a single PTB to erase accrued
    /// funds and steal the recipient's earned tokens.
    ///
    /// The fix shifts last_claim_ms backward by the pre-pause accrual
    /// window, so the next claim/close includes both pre-pause and
    /// post-resume time. If the recipient already claimed while paused
    /// (paused_at_ms cleared to 0), we reset normally.
    public fun resume<T>(
        meter: &mut StreamingMeter<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == meter.payer, ENotPayer);
        assert!(!meter.active, EStreamAlreadyActive);
        // Only resume if budget not exhausted
        assert!(meter.total_claimed < meter.budget_cap, EBudgetCapExceeded);
        assert!(meter.balance.value() > 0, EZeroDeposit);

        let now_ms = clock.timestamp_ms();

        meter.active = true;

        // Preserve pre-pause accrual by time-shifting last_claim_ms.
        // If unclaimed accrual exists (paused_at_ms > last_claim_ms),
        // shift the clock backward so the accrual window carries forward.
        if (meter.paused_at_ms > meter.last_claim_ms) {
            let pre_pause_elapsed = meter.paused_at_ms - meter.last_claim_ms;
            meter.last_claim_ms = now_ms - pre_pause_elapsed;
        } else {
            // Already claimed while paused (paused_at_ms = 0), or no accrual
            meter.last_claim_ms = now_ms;
        };
        meter.paused_at_ms = 0;

        event::emit(StreamResumed {
            meter_id: object::id(meter),
            payer: meter.payer,
            timestamp_ms: now_ms,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Close (payer)
    // ══════════════════════════════════════════════════════════════

    /// Payer closes the stream. Final claim sent to recipient, remainder refunded.
    /// Handles both active and paused streams — paused streams use paused_at_ms
    /// for final accrual (prevents pause→close fund theft).
    /// Consumes the StreamingMeter object.
    public fun close<T>(
        mut meter: StreamingMeter<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == meter.payer, ENotPayer);

        let now_ms = clock.timestamp_ms();

        // Final claim: compute accrued for both active and paused streams
        // Active: accrue up to now
        // Paused with pending accrual: accrue up to paused_at_ms
        // Inactive with no pending: nothing to claim
        let accrued = if (meter.active) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                now_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else if (meter.paused_at_ms > 0) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                meter.paused_at_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else {
            0
        };

        let claimable = if (accrued > meter.balance.value()) {
            meter.balance.value()
        } else {
            accrued
        };

        if (claimable > 0) {
            let fee_amount = calculate_fee(claimable, meter.fee_bps);
            let recipient_amount = claimable - fee_amount;

            if (fee_amount > 0) {
                let fee_balance = meter.balance.split(fee_amount);
                transfer::public_transfer(
                    coin::from_balance(fee_balance, ctx),
                    meter.fee_recipient,
                );
            };

            if (recipient_amount > 0) {
                let claim_balance = meter.balance.split(recipient_amount);
                transfer::public_transfer(
                    coin::from_balance(claim_balance, ctx),
                    meter.recipient,
                );
            };

            meter.total_claimed = meter.total_claimed + claimable;
        };

        let refunded = meter.balance.value();

        event::emit(StreamClosed {
            meter_id: object::id(&meter),
            payer: meter.payer,
            total_claimed: meter.total_claimed,
            refunded,
            timestamp_ms: now_ms,
        });

        // Destructure and clean up
        let StreamingMeter {
            mut id,
            payer,
            recipient: _,
            balance,
            rate_per_second: _,
            budget_cap: _,
            total_claimed: _,
            last_claim_ms: _,
            created_at_ms: _,
            active: _,
            paused_at_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = meter;

        // Refund remaining balance to payer
        if (balance.value() > 0) {
            transfer::public_transfer(coin::from_balance(balance, ctx), payer);
        } else {
            balance.destroy_zero();
        };

        // Remove dynamic field if present (streams created with create_with_timeout)
        if (dynamic_field::exists_<TimeoutKey>(&id, TimeoutKey {})) {
            let _: u64 = dynamic_field::remove(&mut id, TimeoutKey {});
        };

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Recipient close (abandoned stream recovery)
    // ══════════════════════════════════════════════════════════════

    /// Recipient force-closes an abandoned stream after RECIPIENT_CLOSE_TIMEOUT_MS.
    /// Prevents "payer pauses and disappears, funds locked forever" attack.
    /// Claims any accrued amount, refunds remainder to payer.
    /// Timeout measured from the most recent activity (last_claim_ms or paused_at_ms).
    public fun recipient_close<T>(
        mut meter: StreamingMeter<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == meter.recipient, ENotRecipient);

        let now_ms = clock.timestamp_ms();

        // Determine last activity timestamp
        let last_activity = if (meter.paused_at_ms > meter.last_claim_ms) {
            meter.paused_at_ms
        } else {
            meter.last_claim_ms
        };

        // Read per-stream timeout (dynamic field) or fall back to 7-day default
        let timeout = if (dynamic_field::exists_<TimeoutKey>(&meter.id, TimeoutKey {})) {
            *dynamic_field::borrow<TimeoutKey, u64>(&meter.id, TimeoutKey {})
        } else {
            RECIPIENT_CLOSE_TIMEOUT_MS
        };

        // Must have been inactive for at least the timeout period
        assert!(now_ms >= last_activity + timeout, ETimeoutNotReached);

        // Compute final claim (same logic as close/claim)
        let accrued = if (meter.active) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                now_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else if (meter.paused_at_ms > 0) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                meter.paused_at_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else {
            0
        };

        let claimable = if (accrued > meter.balance.value()) {
            meter.balance.value()
        } else {
            accrued
        };

        // Transfer accrued to recipient (with fee split)
        if (claimable > 0) {
            let fee_amount = calculate_fee(claimable, meter.fee_bps);
            let recipient_amount = claimable - fee_amount;

            if (fee_amount > 0) {
                let fee_balance = meter.balance.split(fee_amount);
                transfer::public_transfer(
                    coin::from_balance(fee_balance, ctx),
                    meter.fee_recipient,
                );
            };

            if (recipient_amount > 0) {
                let claim_balance = meter.balance.split(recipient_amount);
                transfer::public_transfer(
                    coin::from_balance(claim_balance, ctx),
                    meter.recipient,
                );
            };

            meter.total_claimed = meter.total_claimed + claimable;
        };

        let refunded = meter.balance.value();

        event::emit(StreamRecipientClosed {
            meter_id: object::id(&meter),
            recipient: meter.recipient,
            payer: meter.payer,
            claimed: claimable,
            refunded,
            timestamp_ms: now_ms,
        });

        // Destructure and clean up
        let StreamingMeter {
            mut id,
            payer,
            recipient: _,
            balance,
            rate_per_second: _,
            budget_cap: _,
            total_claimed: _,
            last_claim_ms: _,
            created_at_ms: _,
            active: _,
            paused_at_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = meter;

        // Refund remaining balance to payer
        if (balance.value() > 0) {
            transfer::public_transfer(coin::from_balance(balance, ctx), payer);
        } else {
            balance.destroy_zero();
        };

        // Remove dynamic field if present (streams created with create_with_timeout)
        if (dynamic_field::exists_<TimeoutKey>(&id, TimeoutKey {})) {
            let _: u64 = dynamic_field::remove(&mut id, TimeoutKey {});
        };

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Top up (payer)
    // ══════════════════════════════════════════════════════════════

    /// Payer adds more funds to an existing stream.
    public fun top_up<T>(
        meter: &mut StreamingMeter<T>,
        deposit: Coin<T>,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        assert!(ctx.sender() == meter.payer, ENotPayer);

        let amount = deposit.value();
        assert!(amount > 0, EZeroDeposit);

        meter.balance.join(coin::into_balance(deposit));

        event::emit(StreamTopUp {
            meter_id: object::id(meter),
            payer: meter.payer,
            amount,
            new_balance: meter.balance.value(),
            timestamp_ms: clock.timestamp_ms(),
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════

    /// Calculate how much the recipient can claim right now.
    /// Returns non-zero for active streams AND paused streams with pending accrual.
    public fun claimable<T>(meter: &StreamingMeter<T>, clock: &Clock): u64 {
        let accrued = if (meter.active) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                clock.timestamp_ms(),
                meter.budget_cap,
                meter.total_claimed,
            )
        } else if (meter.paused_at_ms > 0) {
            calculate_accrued(
                meter.rate_per_second,
                meter.last_claim_ms,
                meter.paused_at_ms,
                meter.budget_cap,
                meter.total_claimed,
            )
        } else {
            return 0
        };

        // Cap at actual balance
        if (accrued > meter.balance.value()) {
            meter.balance.value()
        } else {
            accrued
        }
    }

    public fun meter_payer<T>(m: &StreamingMeter<T>): address { m.payer }
    public fun meter_recipient<T>(m: &StreamingMeter<T>): address { m.recipient }
    public fun meter_balance<T>(m: &StreamingMeter<T>): u64 { m.balance.value() }
    public fun meter_rate_per_second<T>(m: &StreamingMeter<T>): u64 { m.rate_per_second }
    public fun meter_budget_cap<T>(m: &StreamingMeter<T>): u64 { m.budget_cap }
    public fun meter_total_claimed<T>(m: &StreamingMeter<T>): u64 { m.total_claimed }
    public fun meter_active<T>(m: &StreamingMeter<T>): bool { m.active }
    public fun meter_created_at_ms<T>(m: &StreamingMeter<T>): u64 { m.created_at_ms }
    public fun meter_last_claim_ms<T>(m: &StreamingMeter<T>): u64 { m.last_claim_ms }
    public fun meter_fee_bps<T>(m: &StreamingMeter<T>): u64 { m.fee_bps }

    /// Returns the effective recipient close timeout for this stream (ms).
    /// Reads from dynamic field if set, otherwise returns the 7-day default.
    public fun meter_recipient_close_timeout_ms<T>(m: &StreamingMeter<T>): u64 {
        if (dynamic_field::exists_<TimeoutKey>(&m.id, TimeoutKey {})) {
            *dynamic_field::borrow<TimeoutKey, u64>(&m.id, TimeoutKey {})
        } else {
            RECIPIENT_CLOSE_TIMEOUT_MS
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Internal helpers
    // ══════════════════════════════════════════════════════════════

    /// Calculate accrued tokens since last claim.
    /// Uses u128 intermediate for overflow safety (Cetus $223M lesson).
    /// Caps at budget_remaining.
    fun calculate_accrued(
        rate_per_second: u64,
        last_claim_ms: u64,
        now_ms: u64,
        budget_cap: u64,
        total_claimed: u64,
    ): u64 {
        if (now_ms <= last_claim_ms) return 0;

        let elapsed_ms = now_ms - last_claim_ms;

        // rate_per_second * elapsed_ms / 1000, via u128
        let raw = ((rate_per_second as u128) * (elapsed_ms as u128)) / 1000u128;

        // Cap at u64::MAX
        let accrued = if (raw > 0xFFFFFFFFFFFFFFFF) {
            0xFFFFFFFFFFFFFFFF
        } else {
            (raw as u64)
        };

        // Cap at budget remaining
        let budget_remaining = budget_cap - total_claimed;
        if (accrued > budget_remaining) {
            budget_remaining
        } else {
            accrued
        }
    }

    /// Calculate fee with overflow protection (same as payment.move).
    fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        if (fee_bps == 0) return 0;
        let result = ((amount as u128) * (fee_bps as u128)) / 10_000u128;
        // Safe: amount <= u64::MAX, fee_bps <= 10000, so result <= u64::MAX
        (result as u64)
    }
}
