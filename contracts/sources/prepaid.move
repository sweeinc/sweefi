/// SweePay Prepaid Balance — the Agent Killer Feature
///
/// "The first protocol where an AI agent deposits $5, makes 1,000 API calls,
/// and the provider claims earned funds — all with 3 on-chain transactions."
///
/// Trust model: TRUST-BOUNDED, not trustless.
/// The provider submits `call_count` — Move cannot verify calls actually happened.
/// A dishonest provider can drain the balance by lying about call count.
/// Agent's protection:
///   1. Rate cap bounds per-call extraction
///   2. max_calls bounds total extraction
///   3. Deposit amount is the absolute maximum loss
///   4. Small deposits + short refill cycles limit exposure
///   5. Reputation enforcement (dishonest providers lose repeat business)
///
/// Design decisions:
///   - PrepaidBalance is a SHARED object (both agent and provider mutate it)
///   - Cumulative claimed_calls (not incremental) — idempotent retries safe
///   - Clock-based withdrawal lock (not epoch — 24h too coarse)
///   - Two-phase withdrawal: request → grace period → finalize
///     Claims are ALLOWED during grace period (provider's window to submit final claims)
///   - u128 intermediate math for rate * count (Cetus $223M lesson)
///   - Zero-delta claims are no-ops (prevents withdrawal lock griefing)
///   - Per-provider isolation: one PrepaidBalance per agent-provider pair
module sweepay::prepaid {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::event;
    use sui::clock::Clock;
    use std::type_name;
    use std::ascii;
    use sweepay::admin;

    // ══════════════════════════════════════════════════════════════
    // Error codes (600-series)
    // ══════════════════════════════════════════════════════════════

    const ENotAgent: u64 = 600;
    const ENotProvider: u64 = 601;
    const EZeroDeposit: u64 = 602;
    const EZeroRate: u64 = 603;
    const EWithdrawalLocked: u64 = 604;
    const ECallCountRegression: u64 = 605;
    const EMaxCallsExceeded: u64 = 606;
    const ERateLimitExceeded: u64 = 607;
    const EInvalidFeeBps: u64 = 608;
    const EWithdrawalPending: u64 = 609;
    const EWithdrawalNotPending: u64 = 610;
    const EBalanceNotExhausted: u64 = 611;
    const EWithdrawalDelayTooShort: u64 = 612;
    const EWithdrawalDelayTooLong: u64 = 613;

    // ══════════════════════════════════════════════════════════════
    // Constants
    // ══════════════════════════════════════════════════════════════

    /// Minimum withdrawal delay: 1 minute (60,000 ms)
    const MIN_WITHDRAWAL_DELAY_MS: u64 = 60_000;

    /// Maximum withdrawal delay: 7 days (604,800,000 ms) — matches stream.move
    const MAX_WITHDRAWAL_DELAY_MS: u64 = 604_800_000;

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Prepaid balance — shared object.
    /// Agent deposits funds, provider claims via cumulative call count.
    /// phantom T: the coin type (SUI, USDC, etc.)
    ///
    /// NOTE: Named PrepaidBalance (not Balance) to avoid collision with sui::balance::Balance.
    /// NOTE: `agent` field (not `owner`) to distinguish from Sui object ownership.
    public struct PrepaidBalance<phantom T> has key {
        id: UID,
        agent: address,                // depositor
        provider: address,             // authorized claimer
        deposited: Balance<T>,         // locked collateral
        rate_per_call: u64,            // max base-units per call (rate cap)
        claimed_calls: u64,            // CUMULATIVE calls claimed (not incremental)
        max_calls: u64,                // hard cap; u64::MAX = unlimited
        last_claim_ms: u64,            // Clock timestamp of last claim
        withdrawal_delay_ms: u64,      // agent waits this long after last claim to withdraw
        withdrawal_pending: bool,      // two-phase withdrawal flag
        withdrawal_requested_ms: u64,  // when withdrawal was requested
        fee_bps: u64,                  // protocol fee on claims (basis points)
        fee_recipient: address,        // where fees go
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct PrepaidDeposited has copy, drop {
        balance_id: ID,
        agent: address,
        provider: address,
        amount: u64,
        rate_per_call: u64,
        max_calls: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct PrepaidClaimed has copy, drop {
        balance_id: ID,
        provider: address,
        calls_delta: u64,
        total_claimed_calls: u64,
        amount: u64,
        fee_amount: u64,
        remaining: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidWithdrawalRequested has copy, drop {
        balance_id: ID,
        agent: address,
        remaining: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidWithdrawn has copy, drop {
        balance_id: ID,
        agent: address,
        refunded: u64,
        total_claimed_calls: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidTopUp has copy, drop {
        balance_id: ID,
        agent: address,
        amount: u64,
        new_balance: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidClosed has copy, drop {
        balance_id: ID,
        closed_by: address,
        total_claimed_calls: u64,
        timestamp_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Deposit (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent deposits funds and creates a PrepaidBalance shared object.
    /// This is the only function guarded by admin pause.
    public fun deposit<T>(
        coin: Coin<T>,
        provider: address,
        rate_per_call: u64,
        max_calls: u64,
        withdrawal_delay_ms: u64,
        fee_bps: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);

        let amount = coin.value();
        assert!(amount > 0, EZeroDeposit);
        assert!(rate_per_call > 0, EZeroRate);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(withdrawal_delay_ms >= MIN_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooShort);
        assert!(withdrawal_delay_ms <= MAX_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooLong);

        let now_ms = clock.timestamp_ms();
        let agent = ctx.sender();

        let balance = PrepaidBalance<T> {
            id: object::new(ctx),
            agent,
            provider,
            deposited: coin::into_balance(coin),
            rate_per_call,
            claimed_calls: 0,
            max_calls,
            last_claim_ms: now_ms,
            withdrawal_delay_ms,
            withdrawal_pending: false,
            withdrawal_requested_ms: 0,
            fee_bps,
            fee_recipient,
        };

        event::emit(PrepaidDeposited {
            balance_id: object::id(&balance),
            agent,
            provider,
            amount,
            rate_per_call,
            max_calls,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(balance);
    }

    // ══════════════════════════════════════════════════════════════
    // Claim (provider)
    // ══════════════════════════════════════════════════════════════

    /// Provider claims earned funds based on cumulative call count.
    /// Provider says "I've served N total calls". Move computes the delta
    /// from the last claim and transfers `delta * rate_per_call` (minus fees).
    ///
    /// IMPORTANT: Zero-delta claims (cumulative == claimed_calls) are no-ops.
    /// This prevents the provider from griefing the withdrawal lock by spamming
    /// claim(same_count) to indefinitely extend last_claim_ms.
    ///
    /// Claims are ALLOWED during pending withdrawal — the grace period IS
    /// the provider's window to submit final claims.
    public fun claim<T>(
        balance: &mut PrepaidBalance<T>,
        cumulative_call_count: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.provider, ENotProvider);

        // Explicit underflow guard (council CRITICAL F-04)
        assert!(cumulative_call_count >= balance.claimed_calls, ECallCountRegression);

        let delta = cumulative_call_count - balance.claimed_calls;

        // Zero-delta = no-op (prevents withdrawal lock griefing)
        if (delta == 0) return;

        // max_calls cap check
        assert!(cumulative_call_count <= balance.max_calls, EMaxCallsExceeded);

        // u128 intermediate math for overflow safety (council CRITICAL F-05)
        let gross_amount_u128 = (delta as u128) * (balance.rate_per_call as u128);

        // Cap at u64::MAX
        let gross_amount = if (gross_amount_u128 > 0xFFFFFFFFFFFFFFFF) {
            0xFFFFFFFFFFFFFFFF
        } else {
            (gross_amount_u128 as u64)
        };

        // Must have enough balance
        assert!(gross_amount <= balance.deposited.value(), ERateLimitExceeded);

        // Calculate fee (overflow-safe, same as stream.move)
        let fee_amount = calculate_fee(gross_amount, balance.fee_bps);
        let provider_amount = gross_amount - fee_amount;

        // Transfer fee
        if (fee_amount > 0) {
            let fee_bal = balance.deposited.split(fee_amount);
            transfer::public_transfer(
                coin::from_balance(fee_bal, ctx),
                balance.fee_recipient,
            );
        };

        // Transfer to provider
        if (provider_amount > 0) {
            let claim_bal = balance.deposited.split(provider_amount);
            transfer::public_transfer(
                coin::from_balance(claim_bal, ctx),
                balance.provider,
            );
        };

        // Update state
        let now_ms = clock.timestamp_ms();
        balance.claimed_calls = cumulative_call_count;
        balance.last_claim_ms = now_ms;

        event::emit(PrepaidClaimed {
            balance_id: object::id(balance),
            provider: balance.provider,
            calls_delta: delta,
            total_claimed_calls: cumulative_call_count,
            amount: gross_amount,
            fee_amount,
            remaining: balance.deposited.value(),
            timestamp_ms: now_ms,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Two-phase withdrawal (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent signals intent to withdraw remaining funds.
    /// Starts the grace period — provider can still claim during this time.
    /// After withdrawal_delay_ms, agent can call finalize_withdrawal().
    public fun request_withdrawal<T>(
        balance: &mut PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(!balance.withdrawal_pending, EWithdrawalPending);

        let now_ms = clock.timestamp_ms();
        balance.withdrawal_pending = true;
        balance.withdrawal_requested_ms = now_ms;

        event::emit(PrepaidWithdrawalRequested {
            balance_id: object::id(balance),
            agent: balance.agent,
            remaining: balance.deposited.value(),
            timestamp_ms: now_ms,
        });
    }

    /// Agent finalizes withdrawal after the grace period has elapsed.
    /// Destructures the PrepaidBalance, returning remaining funds to agent.
    ///
    /// NOTE: The grace period is anchored to `withdrawal_requested_ms`, NOT `last_claim_ms`.
    /// Late claims during the grace period do NOT extend the delay. This is intentional:
    /// the provider has exactly `withdrawal_delay_ms` from the request to submit final claims.
    public fun finalize_withdrawal<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.withdrawal_pending, EWithdrawalNotPending);

        let now_ms = clock.timestamp_ms();
        assert!(
            now_ms >= balance.withdrawal_requested_ms + balance.withdrawal_delay_ms,
            EWithdrawalLocked,
        );

        let refunded = balance.deposited.value();
        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidWithdrawn {
            balance_id: object::id(&balance),
            agent: balance.agent,
            refunded,
            total_claimed_calls: total_claimed,
            timestamp_ms: now_ms,
        });

        // Destructure and clean up
        let PrepaidBalance {
            id,
            agent,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = balance;

        // Refund remaining to agent
        if (deposited.value() > 0) {
            transfer::public_transfer(coin::from_balance(deposited, ctx), agent);
        } else {
            deposited.destroy_zero();
        };

        id.delete();
    }

    /// Agent cancels a pending withdrawal request. Re-enables normal operation.
    public fun cancel_withdrawal<T>(
        balance: &mut PrepaidBalance<T>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.withdrawal_pending, EWithdrawalNotPending);

        balance.withdrawal_pending = false;
        balance.withdrawal_requested_ms = 0;
    }

    // ══════════════════════════════════════════════════════════════
    // Top up (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent adds more funds to an existing PrepaidBalance.
    /// Blocked during pending withdrawal (would conflict with finalize).
    public fun top_up<T>(
        balance: &mut PrepaidBalance<T>,
        coin: Coin<T>,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(!balance.withdrawal_pending, EWithdrawalPending);

        let amount = coin.value();
        assert!(amount > 0, EZeroDeposit);

        balance.deposited.join(coin::into_balance(coin));

        event::emit(PrepaidTopUp {
            balance_id: object::id(balance),
            agent: balance.agent,
            amount,
            new_balance: balance.deposited.value(),
            timestamp_ms: clock.timestamp_ms(),
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Close (both parties — prevents dead shared objects)
    // ══════════════════════════════════════════════════════════════

    /// Agent closes an exhausted balance (0 remaining).
    /// Returns storage rebate by destructuring the shared object.
    public fun agent_close<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.deposited.value() == 0, EBalanceNotExhausted);

        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidClosed {
            balance_id: object::id(&balance),
            closed_by: balance.agent,
            total_claimed_calls: total_claimed,
            timestamp_ms: clock.timestamp_ms(),
        });

        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = balance;

        deposited.destroy_zero();
        id.delete();
    }

    /// Provider closes a fully-claimed balance.
    /// Returns storage rebate by destructuring the shared object.
    public fun provider_close<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.provider, ENotProvider);
        assert!(balance.deposited.value() == 0, EBalanceNotExhausted);

        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidClosed {
            balance_id: object::id(&balance),
            closed_by: balance.provider,
            total_claimed_calls: total_claimed,
            timestamp_ms: clock.timestamp_ms(),
        });

        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = balance;

        deposited.destroy_zero();
        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════

    public fun balance_agent<T>(b: &PrepaidBalance<T>): address { b.agent }
    public fun balance_provider<T>(b: &PrepaidBalance<T>): address { b.provider }
    public fun balance_remaining<T>(b: &PrepaidBalance<T>): u64 { b.deposited.value() }
    public fun balance_claimed_calls<T>(b: &PrepaidBalance<T>): u64 { b.claimed_calls }
    public fun balance_rate_per_call<T>(b: &PrepaidBalance<T>): u64 { b.rate_per_call }
    public fun balance_max_calls<T>(b: &PrepaidBalance<T>): u64 { b.max_calls }
    public fun balance_withdrawal_pending<T>(b: &PrepaidBalance<T>): bool { b.withdrawal_pending }
    public fun balance_withdrawal_delay_ms<T>(b: &PrepaidBalance<T>): u64 { b.withdrawal_delay_ms }
    public fun balance_last_claim_ms<T>(b: &PrepaidBalance<T>): u64 { b.last_claim_ms }
    public fun balance_fee_bps<T>(b: &PrepaidBalance<T>): u64 { b.fee_bps }

    // ══════════════════════════════════════════════════════════════
    // Internal helpers
    // ══════════════════════════════════════════════════════════════

    /// Calculate fee with overflow protection (same as stream.move + payment.move).
    fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        if (fee_bps == 0) return 0;
        let result = ((amount as u128) * (fee_bps as u128)) / 10_000u128;
        (result as u64)
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun destroy_for_testing<T>(balance: PrepaidBalance<T>) {
        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
        } = balance;

        if (deposited.value() > 0) {
            // In tests we can't easily transfer, so use test-only destroy
            std::unit_test::destroy(deposited);
        } else {
            deposited.destroy_zero();
        };

        id.delete();
    }
}
