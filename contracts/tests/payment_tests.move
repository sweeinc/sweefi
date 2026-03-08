#[test_only]
module sweefi::payment_tests {
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock;
    use sui::test_scenario::{Self as ts};
    use sweefi::payment;

    const MERCHANT: address = @0xBEEF;
    const PAYER: address = @0xCAFE;
    const FEE_RECIPIENT: address = @0xFEE;

    // ══════════════════════════════════════════════════════════════
    // Direct payment tests (pay)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_pay_exact_amount() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        // Create payment coin (1000 units)
        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        // Pay exact amount with 5_000 fee_micro_pct (0.5%)
        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            1000,       // amount
            5_000,      // fee_micro_pct (0.5%)
            FEE_RECIPIENT,
            b"test-payment-001",
            &clock,
            scenario.ctx(),
        );

        // Verify receipt
        assert!(payment::receipt_amount(&receipt) == 1000);
        assert!(payment::receipt_fee_amount(&receipt) == 5); // 1000 * 5_000 / 1_000_000 = 5
        assert!(payment::receipt_payer(&receipt) == PAYER);
        assert!(payment::receipt_recipient(&receipt) == MERCHANT);

        // Cleanup
        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_with_overpayment_returns_change() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        // Create payment coin (2000 units, paying for 1000)
        let payment = coin::mint_for_testing<SUI>(2000, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            1000,
            0,    // no fee
            FEE_RECIPIENT,
            b"overpay-test",
            &clock,
            scenario.ctx(),
        );

        // Receipt should reflect the requested amount, not the overpayment
        assert!(payment::receipt_amount(&receipt) == 1000);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();

        // Verify change was returned to payer
        scenario.next_tx(PAYER);
        let change = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(change.value() == 1000); // 2000 - 1000 = 1000 change
        ts::return_to_address(PAYER, change);

        scenario.end();
    }

    #[test]
    fun test_pay_zero_fee() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(500, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            500,
            0,    // zero fee
            FEE_RECIPIENT,
            b"no-fee",
            &clock,
            scenario.ctx(),
        );

        assert!(payment::receipt_fee_amount(&receipt) == 0);
        assert!(payment::receipt_amount(&receipt) == 500);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_max_fee_100_percent() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        // 1_000_000 = 100% fee
        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            1000,
            1_000_000,
            FEE_RECIPIENT,
            b"max-fee",
            &clock,
            scenario.ctx(),
        );

        assert!(payment::receipt_fee_amount(&receipt) == 1000);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = payment::EInsufficientPayment)]
    fun test_pay_insufficient_funds() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());

        // Try to pay 1000 with only 100
        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            1000,
            0,
            FEE_RECIPIENT,
            b"should-fail",
            &clock,
            scenario.ctx(),
        );

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = payment::EZeroAmount)]
    fun test_pay_zero_amount_fails() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            0,    // zero amount — should fail
            5_000,
            FEE_RECIPIENT,
            b"should-fail",
            &clock,
            scenario.ctx(),
        );

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = payment::EInvalidFeeMicroPct)]
    fun test_pay_invalid_fee_micro_pct() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            1000,
            1_000_001,   // > 1_000_000 — should fail
            FEE_RECIPIENT,
            b"should-fail",
            &clock,
            scenario.ctx(),
        );

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_fee_calculation_large_amount() {
        // Verify overflow protection: large amount * fee_micro_pct uses u128 intermediate
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        // Large amount: 10^18 (like 10^12 USDC with 6 decimals)
        let large_amount: u64 = 1_000_000_000_000_000_000;
        let payment = coin::mint_for_testing<SUI>(large_amount, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            large_amount,
            5_000,   // 0.5%
            FEE_RECIPIENT,
            b"large-amount",
            &clock,
            scenario.ctx(),
        );

        // 10^18 * 5_000 / 1_000_000 = 5 * 10^15
        assert!(payment::receipt_fee_amount(&receipt) == 5_000_000_000_000_000);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Invoice payment tests (pay_invoice)
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_invoice_create_and_pay() {
        let mut scenario = ts::begin(MERCHANT);

        // Merchant creates invoice
        let invoice = payment::create_invoice(
            MERCHANT,
            1000,
            5_000,
            FEE_RECIPIENT,
            scenario.ctx(),
        );

        // Verify invoice fields
        assert!(payment::invoice_recipient(&invoice) == MERCHANT);
        assert!(payment::invoice_expected_amount(&invoice) == 1000);
        assert!(payment::invoice_fee_micro_pct(&invoice) == 5_000);

        // Transfer invoice to payer (simulating off-chain handoff)
        payment::send_invoice(invoice, PAYER);

        // Payer pays the invoice
        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        let receipt = payment::pay_invoice<SUI>(
            invoice,   // consumed — can never be replayed
            payment,
            &clock,
            scenario.ctx(),
        );

        assert!(payment::receipt_amount(&receipt) == 1000);
        assert!(payment::receipt_fee_amount(&receipt) == 5);
        assert!(payment::receipt_payer(&receipt) == PAYER);
        assert!(payment::receipt_recipient(&receipt) == MERCHANT);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_invoice_consumed_after_payment() {
        // After paying an invoice, the Invoice object no longer exists.
        // This IS the replay protection — you can't pay the same Invoice twice
        // because it's been destroyed.
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT,
            500,
            0,
            FEE_RECIPIENT,
            scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(500, scenario.ctx());

        let receipt = payment::pay_invoice<SUI>(invoice, payment, &clock, scenario.ctx());
        transfer::public_transfer(receipt, PAYER);

        // Verify: no more Invoice objects exist for PAYER
        scenario.next_tx(PAYER);
        assert!(!ts::has_most_recent_for_address<payment::Invoice>(PAYER));

        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_invoice_overpayment_returns_change() {
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT,
            500,
            0,
            FEE_RECIPIENT,
            scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(800, scenario.ctx()); // overpay by 300

        let receipt = payment::pay_invoice<SUI>(invoice, payment, &clock, scenario.ctx());
        assert!(payment::receipt_amount(&receipt) == 500); // receipt shows requested amount
        transfer::public_transfer(receipt, PAYER);

        // Verify change returned
        scenario.next_tx(PAYER);
        let change = scenario.take_from_address<coin::Coin<SUI>>(PAYER);
        assert!(change.value() == 300);
        ts::return_to_address(PAYER, change);

        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = payment::EInsufficientPayment)]
    fun test_invoice_insufficient_funds() {
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT,
            1000,
            0,
            FEE_RECIPIENT,
            scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(500, scenario.ctx()); // not enough

        let receipt = payment::pay_invoice<SUI>(invoice, payment, &clock, scenario.ctx());
        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = payment::EZeroAmount)]
    fun test_invoice_zero_amount_fails() {
        let mut scenario = ts::begin(MERCHANT);

        let _invoice = payment::create_invoice(
            MERCHANT,
            0,    // zero — should fail
            50,
            FEE_RECIPIENT,
            scenario.ctx(),
        );

        abort 0 // unreachable
    }

    #[test]
    #[expected_failure(abort_code = payment::EInvalidFeeMicroPct)]
    fun test_invoice_invalid_fee_fails() {
        let mut scenario = ts::begin(MERCHANT);

        let _invoice = payment::create_invoice(
            MERCHANT,
            1000,
            1_000_001, // > 1_000_000 — should fail
            FEE_RECIPIENT,
            scenario.ctx(),
        );

        abort 0 // unreachable
    }

    // ══════════════════════════════════════════════════════════════
    // Clock integration tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_receipt_has_clock_timestamp() {
        let mut scenario = ts::begin(PAYER);
        let mut clock = clock::create_for_testing(scenario.ctx());

        // Set clock to a specific time
        clock.set_for_testing(1707700000000); // ~Feb 12, 2024 in ms

        let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            100,
            0,
            FEE_RECIPIENT,
            b"clock-test",
            &clock,
            scenario.ctx(),
        );

        assert!(payment::receipt_timestamp_ms(&receipt) == 1707700000000);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Accessor tests
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_receipt_memo() {
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());

        let receipt = payment::pay<SUI>(
            payment,
            MERCHANT,
            100,
            0,
            FEE_RECIPIENT,
            b"hello-sweefi",
            &clock,
            scenario.ctx(),
        );

        assert!(payment::receipt_memo(&receipt) == &b"hello-sweefi");

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    // ══════════════════════════════════════════════════════════════
    // Audit coverage: edge cases identified in v0.4 Move audit
    // ══════════════════════════════════════════════════════════════

    #[test]
    fun test_cancel_invoice() {
        // cancel_invoice deletes an unpaid Invoice, preventing zombie objects.
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT, 1000, 5_000, FEE_RECIPIENT, scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        // Payer decides not to pay — cancels the invoice
        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        payment::cancel_invoice(invoice);

        // Invoice should be gone
        scenario.next_tx(PAYER);
        assert!(!ts::has_most_recent_for_address<payment::Invoice>(PAYER));

        scenario.end();
    }

    #[test]
    fun test_destroy_receipt() {
        // destroy_receipt deletes a PaymentReceipt after it's no longer needed.
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(100, scenario.ctx());
        let receipt = payment::pay<SUI>(
            payment, MERCHANT, 100, 0, FEE_RECIPIENT, b"destroy-test", &clock, scenario.ctx(),
        );

        payment::destroy_receipt(receipt);

        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_create_and_send_invoice_entry() {
        // Tests the entry convenience function that creates + transfers in one call.
        let mut scenario = ts::begin(MERCHANT);

        payment::create_and_send_invoice(
            MERCHANT, 500, 10_000, FEE_RECIPIENT, PAYER, scenario.ctx(),
        );

        // Verify invoice arrived at PAYER
        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        assert!(payment::invoice_expected_amount(&invoice) == 500);
        assert!(payment::invoice_recipient(&invoice) == MERCHANT);
        assert!(payment::invoice_fee_micro_pct(&invoice) == 10_000);

        payment::cancel_invoice(invoice);
        scenario.end();
    }

    #[test]
    fun test_pay_and_keep_entry() {
        // Tests the entry wrapper: pay + auto-transfer receipt to payer.
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());
        payment::pay_and_keep<SUI>(
            payment, MERCHANT, 1000, 5_000, FEE_RECIPIENT, b"entry-test", &clock, scenario.ctx(),
        );

        // Verify receipt was transferred to PAYER
        scenario.next_tx(PAYER);
        let receipt = scenario.take_from_address<payment::PaymentReceipt>(PAYER);
        assert!(payment::receipt_amount(&receipt) == 1000);
        assert!(payment::receipt_fee_amount(&receipt) == 5);
        ts::return_to_address(PAYER, receipt);

        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_invoice_and_keep_entry() {
        // Tests the entry wrapper: pay_invoice + auto-transfer receipt to payer.
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT, 1000, 5_000, FEE_RECIPIENT, scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(1000, scenario.ctx());

        payment::pay_invoice_and_keep<SUI>(invoice, payment, &clock, scenario.ctx());

        // Verify receipt was transferred to PAYER
        scenario.next_tx(PAYER);
        let receipt = scenario.take_from_address<payment::PaymentReceipt>(PAYER);
        assert!(payment::receipt_amount(&receipt) == 1000);
        assert!(payment::receipt_fee_amount(&receipt) == 5);
        ts::return_to_address(PAYER, receipt);

        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_amount_1_fee_truncates_to_zero() {
        // Edge case: smallest possible non-zero amount with fee.
        // 0.5% on 1 = 0.005 → truncates to 0. Merchant gets full amount.
        let mut scenario = ts::begin(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());

        let payment = coin::mint_for_testing<SUI>(1, scenario.ctx());
        let receipt = payment::pay<SUI>(
            payment, MERCHANT, 1, 5_000, FEE_RECIPIENT, b"dust", &clock, scenario.ctx(),
        );

        assert!(payment::receipt_amount(&receipt) == 1);
        assert!(payment::receipt_fee_amount(&receipt) == 0);

        transfer::public_transfer(receipt, PAYER);
        clock.destroy_for_testing();
        scenario.end();
    }

    #[test]
    fun test_pay_invoice_100_percent_fee() {
        // 100% fee: entire amount goes to fee_recipient, merchant gets zero.
        // Exercises the destroy_zero branch in pay_invoice.
        let mut scenario = ts::begin(MERCHANT);

        let invoice = payment::create_invoice(
            MERCHANT, 500, 1_000_000, FEE_RECIPIENT, scenario.ctx(),
        );
        payment::send_invoice(invoice, PAYER);

        scenario.next_tx(PAYER);
        let invoice = scenario.take_from_address<payment::Invoice>(PAYER);
        let clock = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(500, scenario.ctx());

        let receipt = payment::pay_invoice<SUI>(invoice, payment, &clock, scenario.ctx());
        assert!(payment::receipt_amount(&receipt) == 500);
        assert!(payment::receipt_fee_amount(&receipt) == 500); // 100% fee

        transfer::public_transfer(receipt, PAYER);

        // Fee recipient should have 500
        scenario.next_tx(FEE_RECIPIENT);
        let fee_coin = scenario.take_from_address<coin::Coin<SUI>>(FEE_RECIPIENT);
        assert!(fee_coin.value() == 500);
        ts::return_to_address(FEE_RECIPIENT, fee_coin);

        clock.destroy_for_testing();
        scenario.end();
    }
}
