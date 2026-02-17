/// SweePay Payment Contract — verify + transfer + fee split + receipt
///
/// Addresses all 6 security findings from adversarial council review:
///   #1: Takes ownership of Coin<T> (not &Coin<T>) — actual settlement
///   #2: Invoice NFTs consumed on payment — replay protection
///   #3: Clock-based timestamps (ms precision, not epoch)
///   #4: (streaming_meter — see stream.move)
///   #5: All objects owned (not shared) — no consensus bottleneck
///   #6: PaymentReceipt has key+store — transferable for composability
///
/// Two payment modes:
///   - pay<T>(): Direct payment with fee split + receipt (facilitator handles dedup)
///   - pay_invoice<T>(): Invoice-gated payment (on-chain dedup via consumed Invoice NFT)
#[allow(lint(self_transfer))]
module sweepay::payment {
    use sui::coin::Coin;
    use sui::event;
    use sui::clock::Clock;
    use std::type_name;
    use std::ascii;
    use sweepay::math;

    // ══════════════════════════════════════════════════════════════
    // Error codes
    // ══════════════════════════════════════════════════════════════

    const EInsufficientPayment: u64 = 0;
    const EZeroAmount: u64 = 1;
    const EInvalidFeeBps: u64 = 2;

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Invoice NFT — owned by creator, consumed on payment.
    /// Council Finding #2: Sui-idiomatic replay dedup without shared registry.
    /// The facilitator (or merchant) creates this. The payer's PTB consumes it.
    public struct Invoice has key {
        id: UID,
        creator: address,
        recipient: address,
        expected_amount: u64,
        fee_bps: u64,
        fee_recipient: address,
    }

    /// On-chain payment receipt — owned by payer.
    /// Council Finding #5: Owned object, no contention.
    /// Council Finding #6: Has `store` for composability (SEAL access condition,
    /// transfer to other protocols). Can be made soul-bound by removing `store`.
    public struct PaymentReceipt has key, store {
        id: UID,
        payer: address,
        recipient: address,
        amount: u64,
        fee_amount: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
        memo: vector<u8>,
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct PaymentSettled has copy, drop {
        receipt_id: ID,
        payer: address,
        recipient: address,
        amount: u64,
        fee_amount: u64,
        fee_recipient: address,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct InvoiceCreated has copy, drop {
        invoice_id: ID,
        creator: address,
        recipient: address,
        expected_amount: u64,
        fee_bps: u64,
    }

    public struct InvoicePaid has copy, drop {
        invoice_id: ID,
        receipt_id: ID,
        payer: address,
        recipient: address,
        amount: u64,
        fee_amount: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Invoice lifecycle
    // ══════════════════════════════════════════════════════════════

    /// Create an Invoice. Caller (merchant or facilitator) gets the owned object.
    /// The Invoice ID is shared with the payer off-chain (e.g., in 402 headers).
    public fun create_invoice(
        recipient: address,
        expected_amount: u64,
        fee_bps: u64,
        fee_recipient: address,
        ctx: &mut TxContext,
    ): Invoice {
        assert!(expected_amount > 0, EZeroAmount);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);

        let invoice = Invoice {
            id: object::new(ctx),
            creator: ctx.sender(),
            recipient,
            expected_amount,
            fee_bps,
            fee_recipient,
        };

        event::emit(InvoiceCreated {
            invoice_id: object::id(&invoice),
            creator: ctx.sender(),
            recipient,
            expected_amount,
            fee_bps,
        });

        invoice
    }

    /// Transfer an Invoice to a recipient (e.g., from facilitator to payer).
    /// Invoice only has `key` (not `store`), so transfers are module-controlled.
    public fun send_invoice(invoice: Invoice, to: address) {
        transfer::transfer(invoice, to);
    }

    /// Create invoice and immediately transfer to a recipient (e.g., the payer).
    /// Convenience entry function for the common case.
    entry fun create_and_send_invoice(
        recipient: address,
        expected_amount: u64,
        fee_bps: u64,
        fee_recipient: address,
        send_to: address,
        ctx: &mut TxContext,
    ) {
        let invoice = create_invoice(recipient, expected_amount, fee_bps, fee_recipient, ctx);
        transfer::transfer(invoice, send_to);
    }

    // ══════════════════════════════════════════════════════════════
    // Payment: Mode 1 — Direct (facilitator handles dedup off-chain)
    // ══════════════════════════════════════════════════════════════

    /// Direct payment: verify amount, split fee, transfer to recipient, mint receipt.
    /// No on-chain invoice required — the facilitator tracks dedup off-chain.
    /// This is the fast path for the x402 flow.
    ///
    /// Council Finding #1: Takes ownership of Coin<T> (not &Coin<T>).
    /// Returns change to payer if overpayment.
    public fun pay<T>(
        mut payment: Coin<T>,
        recipient: address,
        amount: u64,
        fee_bps: u64,
        fee_recipient: address,
        memo: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): PaymentReceipt {
        // Validate inputs
        assert!(amount > 0, EZeroAmount);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(payment.value() >= amount, EInsufficientPayment);

        // Return change if overpayment
        let payment_value = payment.value();
        if (payment_value > amount) {
            let change = payment.split(payment_value - amount, ctx);
            transfer::public_transfer(change, ctx.sender());
        };

        // Calculate fee with overflow protection (u128 intermediate)
        let fee_amount = math::calculate_fee(amount, fee_bps);

        // Split and transfer fee
        if (fee_amount > 0) {
            let fee_coin = payment.split(fee_amount, ctx);
            transfer::public_transfer(fee_coin, fee_recipient);
        };

        // Transfer remainder to recipient (or destroy if 100% fee)
        if (payment.value() > 0) {
            transfer::public_transfer(payment, recipient);
        } else {
            payment.destroy_zero();
        };

        let timestamp_ms = clock.timestamp_ms();
        let token_type = type_name::into_string(type_name::with_defining_ids<T>());

        // Mint receipt
        let receipt = PaymentReceipt {
            id: object::new(ctx),
            payer: ctx.sender(),
            recipient,
            amount,
            fee_amount,
            token_type,
            timestamp_ms,
            memo,
        };

        // Emit event for indexing
        event::emit(PaymentSettled {
            receipt_id: object::id(&receipt),
            payer: ctx.sender(),
            recipient,
            amount,
            fee_amount,
            fee_recipient,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms,
        });

        receipt
    }

    /// Entry convenience: pay and transfer receipt to payer.
    entry fun pay_and_keep<T>(
        payment: Coin<T>,
        recipient: address,
        amount: u64,
        fee_bps: u64,
        fee_recipient: address,
        memo: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let receipt = pay<T>(payment, recipient, amount, fee_bps, fee_recipient, memo, clock, ctx);
        transfer::public_transfer(receipt, ctx.sender());
    }

    // ══════════════════════════════════════════════════════════════
    // Payment: Mode 2 — Invoice-gated (on-chain dedup)
    // ══════════════════════════════════════════════════════════════

    /// Pay an Invoice. The Invoice is consumed (deleted) — it can never be replayed.
    /// Council Finding #2: Sui-idiomatic replay protection.
    ///
    /// The facilitator creates the Invoice, transfers it to the payer (or holds it),
    /// then the payer's PTB passes it here. Once consumed, the Invoice ID is dead.
    public fun pay_invoice<T>(
        invoice: Invoice,
        mut payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): PaymentReceipt {
        // Destructure and consume invoice (replay protection)
        let Invoice {
            id: invoice_uid,
            creator: _,
            recipient,
            expected_amount,
            fee_bps,
            fee_recipient,
        } = invoice;

        let invoice_id = invoice_uid.to_inner();
        invoice_uid.delete();

        // Validate payment
        assert!(expected_amount > 0, EZeroAmount);
        let payment_value = payment.value();
        assert!(payment_value >= expected_amount, EInsufficientPayment);

        // Return change if overpayment
        if (payment_value > expected_amount) {
            let change = payment.split(payment_value - expected_amount, ctx);
            transfer::public_transfer(change, ctx.sender());
        };

        // Calculate fee with overflow protection
        let fee_amount = math::calculate_fee(expected_amount, fee_bps);

        // Split and transfer fee
        if (fee_amount > 0) {
            let fee_coin = payment.split(fee_amount, ctx);
            transfer::public_transfer(fee_coin, fee_recipient);
        };

        // Transfer remainder to recipient (or destroy if 100% fee)
        if (payment.value() > 0) {
            transfer::public_transfer(payment, recipient);
        } else {
            payment.destroy_zero();
        };

        let timestamp_ms = clock.timestamp_ms();
        let token_type = type_name::into_string(type_name::with_defining_ids<T>());

        // Mint receipt
        let receipt = PaymentReceipt {
            id: object::new(ctx),
            payer: ctx.sender(),
            recipient,
            amount: expected_amount,
            fee_amount,
            token_type,
            timestamp_ms,
            memo: b"", // Invoice-based payments don't need a memo
        };

        // Emit event for indexing
        event::emit(InvoicePaid {
            invoice_id,
            receipt_id: object::id(&receipt),
            payer: ctx.sender(),
            recipient,
            amount: expected_amount,
            fee_amount,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms,
        });

        receipt
    }

    /// Entry convenience: pay invoice and keep receipt.
    entry fun pay_invoice_and_keep<T>(
        invoice: Invoice,
        payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let receipt = pay_invoice<T>(invoice, payment, clock, ctx);
        transfer::public_transfer(receipt, ctx.sender());
    }

    // ══════════════════════════════════════════════════════════════
    // Destruction (zombie object prevention)
    // ══════════════════════════════════════════════════════════════

    /// Destroy a payment receipt. Since receipts are owned objects (key + store),
    /// only the current holder's transactions can pass them as arguments.
    /// Use when a receipt is no longer needed (e.g., after indexing off-chain).
    public fun destroy_receipt(receipt: PaymentReceipt) {
        let PaymentReceipt {
            id, payer: _, recipient: _, amount: _, fee_amount: _,
            token_type: _, timestamp_ms: _, memo: _,
        } = receipt;
        object::delete(id);
    }

    /// Cancel an unpaid invoice. The current holder can cancel.
    /// Invoice has `key` only (no `store`), so only module-controlled transfers
    /// are possible — the holder is implicitly authorized.
    /// Use when the invoice is no longer needed (e.g., order cancelled, expired).
    public fun cancel_invoice(invoice: Invoice) {
        let Invoice {
            id, creator: _, recipient: _, expected_amount: _,
            fee_bps: _, fee_recipient: _,
        } = invoice;
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // Accessors
    // ══════════════════════════════════════════════════════════════

    // Receipt accessors
    public fun receipt_payer(r: &PaymentReceipt): address { r.payer }
    public fun receipt_recipient(r: &PaymentReceipt): address { r.recipient }
    public fun receipt_amount(r: &PaymentReceipt): u64 { r.amount }
    public fun receipt_fee_amount(r: &PaymentReceipt): u64 { r.fee_amount }
    public fun receipt_timestamp_ms(r: &PaymentReceipt): u64 { r.timestamp_ms }
    public fun receipt_memo(r: &PaymentReceipt): &vector<u8> { &r.memo }
    public fun receipt_token_type(r: &PaymentReceipt): &ascii::String { &r.token_type }

    // Invoice accessors
    public fun invoice_creator(i: &Invoice): address { i.creator }
    public fun invoice_recipient(i: &Invoice): address { i.recipient }
    public fun invoice_expected_amount(i: &Invoice): u64 { i.expected_amount }
    public fun invoice_fee_bps(i: &Invoice): u64 { i.fee_bps }
    public fun invoice_fee_recipient(i: &Invoice): address { i.fee_recipient }

}
