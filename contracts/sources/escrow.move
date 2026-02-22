/// SweeFi Escrow Contract — time-locked vault with arbiter dispute resolution
///
/// Third and final contract. Enables trustless commerce via:
///   - Clock-based deadlines (ms precision via sui::clock::Clock)
///   - Arbiter-mediated dispute resolution (any address, no registry)
///   - Permissionless timeout refund (anyone can trigger after deadline)
///   - SEAL integration: EscrowReceipt.escrow_id = SEAL access condition
///
/// State machine:
///   ACTIVE ─── buyer release() ──────────→ RELEASED (terminal, receipt minted)
///     │   └─── deadline passes, refund() → REFUNDED (terminal, no fee)
///     │
///     └── buyer/seller dispute() ──→ DISPUTED
///                                     ├── arbiter release() → RELEASED
///                                     └── arbiter refund()  → REFUNDED
///                                     └── deadline passes   → REFUNDED (arbiter griefing protection)
///
/// Key design decisions:
///   - Shared object (3 parties: buyer, seller, arbiter all need to mutate)
///   - NOT on the hot payment path — shared object contention is acceptable
///   - No partial release (V2 if market demands)
///   - No deadline extension on ACTIVE escrows (griefing vector)
///   - DISPUTED escrows get bounded proportional grace period (prevents refund race condition)
///     Grace = clamp(original_duration × 50%, 7 days, 30 days)
///   - No fee on refund (buyer shouldn't pay for failed delivery)
///   - Error codes: 200-series (payment=0-series, stream=100-series)
#[allow(lint(self_transfer), unused_const)]
module sweefi::escrow {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::event;
    use sui::clock::Clock;
    use std::type_name;
    use std::ascii;
    use sweefi::admin;
    use sweefi::math;

    // ══════════════════════════════════════════════════════════════
    // Error codes (200-series)
    // ══════════════════════════════════════════════════════════════

    const ENotBuyer: u64 = 200;
    const ENotSeller: u64 = 201;
    const ENotArbiter: u64 = 202;
    const ENotAuthorized: u64 = 203;
    const EDeadlineInPast: u64 = 204;
    const EDeadlineNotReached: u64 = 205;
    const EAlreadyResolved: u64 = 206;
    const ENotDisputed: u64 = 207;
    const EAlreadyDisputed: u64 = 208;
    const EZeroAmount: u64 = 209;
    const EInvalidFeeBps: u64 = 210;
    const EDescriptionTooLong: u64 = 211;
    const EArbiterIsSeller: u64 = 212;
    const EArbiterIsBuyer: u64 = 213;
    const EBuyerIsSeller: u64 = 214;

    // ══════════════════════════════════════════════════════════════
    // State constants
    // ══════════════════════════════════════════════════════════════

    // Move has no enums; u8 is the idiomatic alternative. Only these four
    // values are ever written; the type system cannot enforce exhaustiveness,
    // so every match must be reviewed manually against this set.
    const STATE_ACTIVE: u8 = 0;
    const STATE_DISPUTED: u8 = 1;
    const STATE_RELEASED: u8 = 2;
    const STATE_REFUNDED: u8 = 3;

    /// Minimum deposit: 1,000,000 base units (0.001 SUI or 1 USDC).
    /// Prevents dust-deposit spam creating near-empty shared escrow objects.
    const MIN_DEPOSIT: u64 = 1_000_000;

    // ══════════════════════════════════════════════════════════════
    // Dispute grace period constants
    //
    // When dispute() is called, the deadline is extended (if needed) to give
    // the arbiter time to investigate and rule. Without this, a buyer's
    // refund bot can front-run the arbiter's release() after the original
    // deadline passes — enabling theft (buyer keeps goods + gets refund).
    //
    // Grace = clamp(original_duration × 50%, FLOOR, CAP)
    // Uses the same micro-percent unit as math.move's FEE_DENOMINATOR.
    // ══════════════════════════════════════════════════════════════

    /// 50% of original escrow duration, in micro-percent (500_000 / 1_000_000 = 50%)
    const GRACE_RATIO: u64 = 500_000;
    /// Minimum grace period: 7 days. Protects short escrows (digital goods).
    const GRACE_FLOOR_MS: u64 = 604_800_000;
    /// Maximum grace period: 30 days. Bounds lockup extension on long escrows.
    const GRACE_CAP_MS: u64 = 2_592_000_000;

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Escrow vault — shared object (3 parties need to interact).
    /// Buyer deposits funds, locked until release or timeout.
    /// phantom T: the coin type (USDC, SUI, suiUSDe, etc.)
    public struct Escrow<phantom T> has key {
        id: UID,
        buyer: address,
        seller: address,
        arbiter: address,
        balance: Balance<T>,    // live balance; decreases as fee/proceeds are split on resolution
        amount: u64,            // original deposit — balance cannot be used for events after destructuring
        deadline_ms: u64,       // Clock.timestamp_ms() threshold; after this anyone can trigger refund
        state: u8,              // STATE_ACTIVE | STATE_DISPUTED | STATE_RELEASED | STATE_REFUNDED
        fee_bps: u64,           // facilitator fee on release only; 1_000_000 = 100% — see math.move
        fee_recipient: address, // where the fee portion goes on release
        created_at_ms: u64,     // creation timestamp for off-chain analytics
        description: vector<u8>, // buyer-supplied context; max 1024 bytes; not validated on-chain
    }

    /// Escrow receipt — proof of successful release.
    /// Has `key` + `store` for SEAL composability.
    /// SEAL integration: seller encrypts deliverable with policy
    /// "owns EscrowReceipt where escrow_id == X". The escrow_id is known
    /// at creation time (before release), so seller can encrypt immediately.
    /// After release, buyer gets this receipt and can decrypt via SEAL.
    public struct EscrowReceipt has key, store {
        id: UID,
        escrow_id: ID,          // ID of the now-deleted Escrow — THIS is the SEAL anchor
        buyer: address,
        seller: address,
        amount: u64,            // original deposit amount (gross, including fee)
        fee_amount: u64,        // portion sent to fee_recipient; seller received amount - fee_amount
        token_type: ascii::String,
        released_at_ms: u64,
        released_by: address,   // buyer (voluntary) or arbiter (dispute resolved in seller's favor)
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct EscrowCreated has copy, drop {
        escrow_id: ID,
        buyer: address,
        seller: address,
        arbiter: address,
        amount: u64,
        deadline_ms: u64,
        fee_bps: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct EscrowReleased has copy, drop {
        escrow_id: ID,
        receipt_id: ID,
        buyer: address,
        seller: address,
        amount: u64,
        fee_amount: u64,
        released_by: address,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct EscrowRefunded has copy, drop {
        escrow_id: ID,
        buyer: address,
        seller: address,
        amount: u64,
        refunded_by: address,
        reason: u8,             // STATE_ACTIVE (timeout refund) or STATE_DISPUTED (arbiter refund)
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct EscrowDisputed has copy, drop {
        escrow_id: ID,
        disputed_by: address,
        timestamp_ms: u64,
        new_deadline_ms: u64,   // effective deadline after grace period (may equal original)
    }

    // ══════════════════════════════════════════════════════════════
    // Create
    // ══════════════════════════════════════════════════════════════

    /// Create a new escrow. Buyer deposits funds, locked until release or deadline.
    /// The Escrow is shared — buyer, seller, and arbiter can all interact.
    /// The Escrow ID is immediately known and can be used as the SEAL anchor
    /// BEFORE release (seller encrypts against this ID).
    public fun create<T>(
        deposit: Coin<T>,
        seller: address,
        arbiter: address,
        deadline_ms: u64,
        fee_bps: u64,
        fee_recipient: address,
        description: vector<u8>,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        let now_ms = clock.timestamp_ms();
        let deposit_value = deposit.value();

        // H-6: Enforce minimum deposit to prevent dust spam on shared objects
        assert!(deposit_value >= MIN_DEPOSIT, EZeroAmount);
        assert!(deadline_ms > now_ms, EDeadlineInPast);
        assert!(fee_bps <= 1_000_000, EInvalidFeeBps);
        assert!(description.length() <= 1024, EDescriptionTooLong);
        // Prevent seller == arbiter: seller could dispute() then release() as arbiter,
        // bypassing buyer consent entirely. See security audit session 128.
        assert!(arbiter != seller, EArbiterIsSeller);

        let buyer = ctx.sender();
        // Prevent buyer == arbiter: buyer could dispute() then release() as arbiter,
        // self-approving without seller delivery. Same bypass vector, reversed role.
        assert!(arbiter != buyer, EArbiterIsBuyer);
        // F-07: Prevent buyer == seller — same party on both sides defeats the
        // trustless commerce guarantee entirely.
        assert!(buyer != seller, EBuyerIsSeller);

        let escrow = Escrow<T> {
            id: object::new(ctx),
            buyer,
            seller,
            arbiter,
            balance: coin::into_balance(deposit),
            amount: deposit_value,
            deadline_ms,
            state: STATE_ACTIVE,
            fee_bps,
            fee_recipient,
            created_at_ms: now_ms,
            description,
        };

        event::emit(EscrowCreated {
            escrow_id: object::id(&escrow),
            buyer,
            seller,
            arbiter,
            amount: deposit_value,
            deadline_ms,
            fee_bps,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(escrow);
    }

    // ══════════════════════════════════════════════════════════════
    // Release (buyer or arbiter)
    // ══════════════════════════════════════════════════════════════

    /// Release funds to seller. Mints an EscrowReceipt for SEAL integration.
    ///
    /// Authorization:
    ///   - Buyer can release when ACTIVE (confirms delivery)
    ///   - Arbiter can release when DISPUTED (resolves in seller's favor)
    ///
    /// Fee is charged on release (not on refund). This incentivizes successful trades.
    /// Consumes the Escrow object.
    public fun release<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): EscrowReceipt {
        let Escrow {
            id,
            buyer,
            seller,
            arbiter,
            balance,
            amount,
            deadline_ms: _,
            state,
            fee_bps,
            fee_recipient,
            created_at_ms: _,
            description: _,
        } = escrow;

        let sender = ctx.sender();
        let escrow_id = id.to_inner();

        // State check before sender check: gives the caller a more informative abort
        // ("already resolved") rather than a confusing "not buyer/arbiter" error.
        assert!(state == STATE_ACTIVE || state == STATE_DISPUTED, EAlreadyResolved);
        if (state == STATE_ACTIVE) {
            assert!(sender == buyer, ENotBuyer);
        } else {
            // STATE_DISPUTED — only arbiter can release
            assert!(sender == arbiter, ENotArbiter);
        };

        let now_ms = clock.timestamp_ms();

        // Calculate fee with overflow protection (u128 intermediate)
        let fee_amount = math::calculate_fee(amount, fee_bps);
        // _seller_amount is computed for documentation clarity — the balance split
        // handles the arithmetic implicitly; this makes the intent legible to auditors.
        let _seller_amount = amount - fee_amount;

        // Split fee from balance
        let mut bal = balance;
        if (fee_amount > 0) {
            let fee_balance = bal.split(fee_amount);
            transfer::public_transfer(
                coin::from_balance(fee_balance, ctx),
                fee_recipient,
            );
        };

        // Transfer remainder to seller (or destroy if 100% fee)
        if (bal.value() > 0) {
            transfer::public_transfer(
                coin::from_balance(bal, ctx),
                seller,
            );
        } else {
            bal.destroy_zero();
        };

        let token_type = type_name::into_string(type_name::with_defining_ids<T>());

        // Mint receipt (SEAL anchor: escrow_id is the access condition)
        let receipt = EscrowReceipt {
            id: object::new(ctx),
            escrow_id,
            buyer,
            seller,
            amount,
            fee_amount,
            token_type,
            released_at_ms: now_ms,
            released_by: sender,
        };

        event::emit(EscrowReleased {
            escrow_id,
            receipt_id: object::id(&receipt),
            buyer,
            seller,
            amount,
            fee_amount,
            released_by: sender,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        id.delete();

        receipt
    }

    /// Entry convenience: release and transfer receipt to buyer.
    entry fun release_and_keep<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let buyer = escrow.buyer;
        let receipt = release<T>(escrow, clock, ctx);
        transfer::public_transfer(receipt, buyer);
    }

    // ══════════════════════════════════════════════════════════════
    // Refund (deadline-based or arbiter)
    // ══════════════════════════════════════════════════════════════

    /// Refund funds to buyer. No fee charged on refunds.
    ///
    /// Authorization:
    ///   - Anyone can trigger after deadline passes (permissionless — prevents key-loss lockup)
    ///   - Arbiter can trigger on DISPUTED escrows (resolves in buyer's favor)
    ///
    /// Consumes the Escrow object.
    public fun refund<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let Escrow {
            id,
            buyer,
            seller,
            arbiter,
            balance,
            amount,
            deadline_ms,
            state,
            fee_bps: _,
            fee_recipient: _,
            created_at_ms: _,
            description: _,
        } = escrow;

        let sender = ctx.sender();
        let escrow_id = id.to_inner();
        let now_ms = clock.timestamp_ms();

        assert!(state == STATE_ACTIVE || state == STATE_DISPUTED, EAlreadyResolved);

        // Two refund paths:
        // 1. Deadline passed — anyone can trigger (permissionless timeout)
        // 2. Arbiter refund on disputed escrow
        if (now_ms >= deadline_ms) {
            // Path 1: Deadline passed — permissionless refund.
            // The empty block is intentional: Move has no "else if" with an empty body
            // shorthand. The logic here is "no auth required; proceed unconditionally."
        } else if (state == STATE_DISPUTED) {
            // Path 2: Arbiter refund before deadline
            assert!(sender == arbiter, ENotArbiter);
        } else {
            // ACTIVE and deadline not reached — cannot refund
            abort EDeadlineNotReached
        };

        // No fee on refund — buyer shouldn't pay for failed delivery.
        // `reason` captures the pre-destructure state for the event.
        let reason = state;

        if (balance.value() > 0) {
            transfer::public_transfer(
                coin::from_balance(balance, ctx),
                buyer,
            );
        } else {
            balance.destroy_zero();
        };

        event::emit(EscrowRefunded {
            escrow_id,
            buyer,
            seller,
            amount,
            refunded_by: sender,
            reason,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Dispute (buyer or seller)
    // ══════════════════════════════════════════════════════════════

    /// Raise a dispute. Moves state from ACTIVE to DISPUTED.
    /// After dispute, only the arbiter can release or refund (or deadline timeout).
    ///
    /// Both buyer and seller can dispute:
    ///   - Buyer disputes if delivery not as expected
    ///   - Seller disputes if buyer won't release despite delivery
    public fun dispute<T>(
        escrow: &mut Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();

        assert!(escrow.state == STATE_ACTIVE, EAlreadyDisputed);
        assert!(sender == escrow.buyer || sender == escrow.seller, ENotAuthorized);

        escrow.state = STATE_DISPUTED;

        // Grace period: ensure arbiter has proportional time to resolve.
        // Without this, a buyer's refund bot can front-run the arbiter's
        // release() the instant the original deadline passes.
        let now_ms = clock.timestamp_ms();
        let duration = escrow.deadline_ms - escrow.created_at_ms;
        let proportional = ((((duration as u128) * (GRACE_RATIO as u128)) / 1_000_000u128) as u64);
        let grace = if (proportional < GRACE_FLOOR_MS) {
            GRACE_FLOOR_MS
        } else if (proportional > GRACE_CAP_MS) {
            GRACE_CAP_MS
        } else {
            proportional
        };
        let min_deadline = now_ms + grace;
        if (min_deadline > escrow.deadline_ms) {
            escrow.deadline_ms = min_deadline;
        };

        event::emit(EscrowDisputed {
            escrow_id: object::id(escrow),
            disputed_by: sender,
            timestamp_ms: now_ms,
            new_deadline_ms: escrow.deadline_ms,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Destruction (zombie object prevention)
    // ══════════════════════════════════════════════════════════════

    /// Destroy an escrow receipt. Since receipts are owned objects (key + store),
    /// only the current holder's transactions can pass them as arguments.
    public fun destroy_receipt(receipt: EscrowReceipt) {
        let EscrowReceipt {
            id, escrow_id: _, buyer: _, seller: _, amount: _,
            fee_amount: _, token_type: _, released_at_ms: _, released_by: _,
        } = receipt;
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════

    // Escrow accessors
    public fun escrow_buyer<T>(e: &Escrow<T>): address { e.buyer }
    public fun escrow_seller<T>(e: &Escrow<T>): address { e.seller }
    public fun escrow_arbiter<T>(e: &Escrow<T>): address { e.arbiter }
    public fun escrow_balance<T>(e: &Escrow<T>): u64 { e.balance.value() }
    public fun escrow_amount<T>(e: &Escrow<T>): u64 { e.amount }
    public fun escrow_deadline_ms<T>(e: &Escrow<T>): u64 { e.deadline_ms }
    public fun escrow_state<T>(e: &Escrow<T>): u8 { e.state }
    public fun escrow_fee_bps<T>(e: &Escrow<T>): u64 { e.fee_bps }
    public fun escrow_created_at_ms<T>(e: &Escrow<T>): u64 { e.created_at_ms }
    public fun escrow_description<T>(e: &Escrow<T>): &vector<u8> { &e.description }

    // Receipt accessors
    public fun receipt_escrow_id(r: &EscrowReceipt): ID { r.escrow_id }
    public fun receipt_buyer(r: &EscrowReceipt): address { r.buyer }
    public fun receipt_seller(r: &EscrowReceipt): address { r.seller }
    public fun receipt_amount(r: &EscrowReceipt): u64 { r.amount }
    public fun receipt_fee_amount(r: &EscrowReceipt): u64 { r.fee_amount }
    public fun receipt_released_at_ms(r: &EscrowReceipt): u64 { r.released_at_ms }
    public fun receipt_released_by(r: &EscrowReceipt): address { r.released_by }
    public fun receipt_token_type(r: &EscrowReceipt): &ascii::String { &r.token_type }

}
