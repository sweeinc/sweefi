/// SweeFi Upto Deposit — variable-amount payment with client-enforced ceiling
///
/// "Pay up to X" — the first on-chain primitive where the payer deposits a maximum
/// and the facilitator settles the actual usage, with the remainder returned.
///
/// Use case: API metering, compute billing, any scenario where the exact cost
/// isn't known at payment time but the payer wants an on-chain spending cap.
///
/// State machine:
///   PENDING ─── facilitator settle() ──→ SETTLED (terminal, fee charged)
///     │
///     └── deadline passes, expire() ───→ EXPIRED (terminal, no fee, full refund)
///
/// Key design decisions:
///   - Shared object (payer deposits, facilitator settles — both need access)
///   - settlement_ceiling: client-enforced on-chain cap on actualAmount.
///     Prevents facilitator from settling more than the payer authorized.
///     Optional — 0 means "no ceiling, settle up to maxAmount."
///   - Only the recipient can settle (they know the actual usage)
///   - Expire is permissionless after deadline (prevents key-loss lockup)
///   - No fee on expire (payer shouldn't pay for unused service)
///   - Error codes: 700-series
#[allow(lint(self_transfer), unused_const)]
module sweefi::upto_deposit {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::event;
    use sui::clock::Clock;
    use std::type_name;
    use std::ascii;
    use sweefi::admin;
    use sweefi::math;

    // ══════════════════════════════════════════════════════════════
    // Error codes (700-series)
    // ══════════════════════════════════════════════════════════════

    const EZeroAmount: u64 = 700;
    const EDeadlineInPast: u64 = 701;
    const EInvalidFeeMicroPct: u64 = 702;
    const ENotPending: u64 = 703;
    const ENotRecipient: u64 = 704;
    const EDeadlineNotReached: u64 = 705;
    const ESettleAmountTooHigh: u64 = 706;
    const ESettleAmountZero: u64 = 707;
    const ECeilingExceedsMax: u64 = 708;
    const EPayerIsRecipient: u64 = 709;
    const EDeadlineReached: u64 = 710;

    // ══════════════════════════════════════════════════════════════
    // State constants
    // ══════════════════════════════════════════════════════════════

    const STATE_PENDING: u8 = 0;
    const STATE_SETTLED: u8 = 1;
    const STATE_EXPIRED: u8 = 2;

    /// Minimum deposit: 1,000,000 base units (0.001 SUI or 1 USDC).
    /// Consistent with escrow/stream/prepaid MIN_DEPOSIT.
    const MIN_DEPOSIT: u64 = 1_000_000;

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Upto deposit vault — shared object (payer deposits, recipient settles).
    /// phantom T: the coin type (USDC, SUI, suiUSDe, etc.)
    public struct UptoDeposit<phantom T> has key {
        id: UID,
        payer: address,
        recipient: address,
        balance: Balance<T>,
        max_amount: u64,                // original deposit amount — the absolute cap
        settlement_ceiling: u64,        // client-enforced cap on settle amount; 0 = no ceiling
        settlement_deadline_ms: u64,    // Clock.timestamp_ms() threshold; after this, permissionless expire
        state: u8,                      // STATE_PENDING | STATE_SETTLED | STATE_EXPIRED
        fee_micro_pct: u64,             // facilitator fee on settle only; 1_000_000 = 100%
        fee_recipient: address,
        created_at_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct UptoDepositCreated has copy, drop {
        deposit_id: ID,
        payer: address,
        recipient: address,
        max_amount: u64,
        settlement_ceiling: u64,
        settlement_deadline_ms: u64,
        fee_micro_pct: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct UptoDepositSettled has copy, drop {
        deposit_id: ID,
        payer: address,
        recipient: address,
        actual_amount: u64,
        fee_amount: u64,
        refunded: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct UptoDepositExpired has copy, drop {
        deposit_id: ID,
        payer: address,
        max_amount: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Create
    // ══════════════════════════════════════════════════════════════

    /// Create an upto deposit without a settlement ceiling.
    /// The recipient can settle any amount up to max_amount.
    public fun create<T>(
        deposit: Coin<T>,
        recipient: address,
        settlement_deadline_ms: u64,
        fee_micro_pct: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        create_internal<T>(
            deposit,
            recipient,
            0, // no ceiling
            settlement_deadline_ms,
            fee_micro_pct,
            fee_recipient,
            protocol_state,
            clock,
            ctx,
        );
    }

    /// Create an upto deposit with a client-enforced settlement ceiling.
    /// The recipient cannot settle more than `settlement_ceiling`, even if
    /// `max_amount` is higher. This gives the payer on-chain spending control.
    public fun create_with_ceiling<T>(
        deposit: Coin<T>,
        recipient: address,
        settlement_ceiling: u64,
        settlement_deadline_ms: u64,
        fee_micro_pct: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let deposit_value = deposit.value();
        assert!(settlement_ceiling > 0 && settlement_ceiling <= deposit_value, ECeilingExceedsMax);

        create_internal<T>(
            deposit,
            recipient,
            settlement_ceiling,
            settlement_deadline_ms,
            fee_micro_pct,
            fee_recipient,
            protocol_state,
            clock,
            ctx,
        );
    }

    /// Shared creation logic for both create() and create_with_ceiling().
    fun create_internal<T>(
        deposit: Coin<T>,
        recipient: address,
        settlement_ceiling: u64,
        settlement_deadline_ms: u64,
        fee_micro_pct: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state, clock);
        let now_ms = clock.timestamp_ms();
        let deposit_value = deposit.value();
        let payer = ctx.sender();

        assert!(deposit_value >= MIN_DEPOSIT, EZeroAmount);
        assert!(settlement_deadline_ms > now_ms, EDeadlineInPast);
        assert!(fee_micro_pct <= 1_000_000, EInvalidFeeMicroPct);
        assert!(payer != recipient, EPayerIsRecipient);

        let upto = UptoDeposit<T> {
            id: object::new(ctx),
            payer,
            recipient,
            balance: coin::into_balance(deposit),
            max_amount: deposit_value,
            settlement_ceiling,
            settlement_deadline_ms,
            state: STATE_PENDING,
            fee_micro_pct,
            fee_recipient,
            created_at_ms: now_ms,
        };

        event::emit(UptoDepositCreated {
            deposit_id: object::id(&upto),
            payer,
            recipient,
            max_amount: deposit_value,
            settlement_ceiling,
            settlement_deadline_ms,
            fee_micro_pct,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(upto);
    }

    // ══════════════════════════════════════════════════════════════
    // Settle (recipient only)
    // ══════════════════════════════════════════════════════════════

    /// Recipient settles the deposit for the actual usage amount.
    /// Fee is charged on the settled amount. Remainder refunded to payer.
    /// Must be called before the settlement deadline.
    ///
    /// Invariants enforced:
    ///   - actual_amount > 0 (no zero-value settlements)
    ///   - actual_amount <= max_amount (can't settle more than deposited)
    ///   - actual_amount <= settlement_ceiling (if ceiling is set)
    ///   - Only recipient can settle
    ///   - Must be in PENDING state
    ///
    /// Consumes the UptoDeposit object.
    public fun settle<T>(
        upto: UptoDeposit<T>,
        actual_amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let UptoDeposit {
            id,
            payer,
            recipient,
            balance,
            max_amount,
            settlement_ceiling,
            settlement_deadline_ms,
            state,
            fee_micro_pct,
            fee_recipient,
            created_at_ms: _,
        } = upto;

        let sender = ctx.sender();
        let deposit_id = id.to_inner();
        let now_ms = clock.timestamp_ms();

        assert!(state == STATE_PENDING, ENotPending);
        assert!(sender == recipient, ENotRecipient);
        // Recipient must settle BEFORE the deadline. After the deadline,
        // permissionless expire() is the payer's unconditional safety net.
        // Without this check, a recipient could front-run expire() to take
        // funds the payer expected to recover. Matches escrow.move pattern.
        assert!(now_ms < settlement_deadline_ms, EDeadlineReached);
        assert!(actual_amount > 0, ESettleAmountZero);
        assert!(actual_amount <= max_amount, ESettleAmountTooHigh);

        // Enforce settlement ceiling if set (0 = no ceiling)
        if (settlement_ceiling > 0) {
            assert!(actual_amount <= settlement_ceiling, ESettleAmountTooHigh);
        };

        // Calculate fee with overflow protection (u128 intermediate)
        let fee_amount = math::calculate_fee(actual_amount, fee_micro_pct);
        let recipient_amount = actual_amount - fee_amount;
        let refunded = max_amount - actual_amount;

        let mut bal = balance;

        // Transfer fee
        if (fee_amount > 0) {
            let fee_balance = bal.split(fee_amount);
            transfer::public_transfer(
                coin::from_balance(fee_balance, ctx),
                fee_recipient,
            );
        };

        // Transfer settled amount (minus fee) to recipient
        if (recipient_amount > 0) {
            let recipient_balance = bal.split(recipient_amount);
            transfer::public_transfer(
                coin::from_balance(recipient_balance, ctx),
                recipient,
            );
        };

        // Refund remainder to payer
        if (bal.value() > 0) {
            transfer::public_transfer(
                coin::from_balance(bal, ctx),
                payer,
            );
        } else {
            bal.destroy_zero();
        };

        let token_type = type_name::into_string(type_name::with_defining_ids<T>());

        event::emit(UptoDepositSettled {
            deposit_id,
            payer,
            recipient,
            actual_amount,
            fee_amount,
            refunded,
            token_type,
            timestamp_ms: now_ms,
        });

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Expire (permissionless after deadline)
    // ══════════════════════════════════════════════════════════════

    /// Expire an unsettled deposit after the deadline. Permissionless — anyone
    /// can trigger (prevents key-loss lockup). No fee charged on expire.
    ///
    /// Consumes the UptoDeposit object.
    public fun expire<T>(
        upto: UptoDeposit<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let UptoDeposit {
            id,
            payer,
            recipient: _,
            balance,
            max_amount,
            settlement_ceiling: _,
            settlement_deadline_ms,
            state,
            fee_micro_pct: _,
            fee_recipient: _,
            created_at_ms: _,
        } = upto;

        let deposit_id = id.to_inner();
        let now_ms = clock.timestamp_ms();

        assert!(state == STATE_PENDING, ENotPending);
        assert!(now_ms >= settlement_deadline_ms, EDeadlineNotReached);

        // Full refund to payer — no fee on unused service
        if (balance.value() > 0) {
            transfer::public_transfer(
                coin::from_balance(balance, ctx),
                payer,
            );
        } else {
            balance.destroy_zero();
        };

        event::emit(UptoDepositExpired {
            deposit_id,
            payer,
            max_amount,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════

    public fun deposit_payer<T>(d: &UptoDeposit<T>): address { d.payer }
    public fun deposit_recipient<T>(d: &UptoDeposit<T>): address { d.recipient }
    public fun deposit_balance<T>(d: &UptoDeposit<T>): u64 { d.balance.value() }
    public fun deposit_max_amount<T>(d: &UptoDeposit<T>): u64 { d.max_amount }
    public fun deposit_settlement_ceiling<T>(d: &UptoDeposit<T>): u64 { d.settlement_ceiling }
    public fun deposit_settlement_deadline_ms<T>(d: &UptoDeposit<T>): u64 { d.settlement_deadline_ms }
    public fun deposit_state<T>(d: &UptoDeposit<T>): u8 { d.state }
    public fun deposit_fee_micro_pct<T>(d: &UptoDeposit<T>): u64 { d.fee_micro_pct }
    public fun deposit_fee_recipient<T>(d: &UptoDeposit<T>): address { d.fee_recipient }
    public fun deposit_created_at_ms<T>(d: &UptoDeposit<T>): u64 { d.created_at_ms }

    // Test-only helpers
    #[test_only]
    public fun state_pending(): u8 { STATE_PENDING }
    #[test_only]
    public fun state_settled(): u8 { STATE_SETTLED }
    #[test_only]
    public fun state_expired(): u8 { STATE_EXPIRED }
}
