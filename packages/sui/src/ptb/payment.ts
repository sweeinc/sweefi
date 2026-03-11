import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig, PayParams, CreateInvoiceParams, PayInvoiceParams } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

/**
 * Build a PTB for direct payment with fee split + receipt.
 * Uses `pay_and_keep` entry — receipt auto-transferred to sender.
 *
 * This is the simple path for one-shot payments outside the s402 flow.
 * For composable PTBs (e.g., pay + use receipt as SEAL condition), use buildPayComposableTx.
 */
export function buildPayTx(config: SweefiConfig, params: PayParams): Transaction {
  assertPositive(params.amount, "amount", "buildPayTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildPayTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  const memo = typeof params.memo === "string"
    ? new TextEncoder().encode(params.memo)
    : params.memo ?? new Uint8Array();

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::payment::pay_and_keep`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.amount),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a composable PTB for payment that returns the PaymentReceipt.
 * Uses `pay` public function — the receipt is returned as a TransactionResult
 * that can be used in subsequent moveCall/transferObjects within the same PTB.
 *
 * Example: pay + use receipt ID as SEAL access condition in one atomic tx.
 *
 * @returns Object with `tx` (the Transaction) and `receipt` (TransactionResult for the PaymentReceipt)
 */
export function buildPayComposableTx(
  config: SweefiConfig,
  params: PayParams,
) {
  assertPositive(params.amount, "amount", "buildPayComposableTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildPayComposableTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  const memo = typeof params.memo === "string"
    ? new TextEncoder().encode(params.memo)
    : params.memo ?? new Uint8Array();

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  const receipt = tx.moveCall({
    target: `${config.packageId}::payment::pay`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.amount),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(SUI_CLOCK),
    ],
  });

  return { tx, receipt };
}

/**
 * Build a PTB to create an invoice.
 * If `sendTo` is provided, uses `create_and_send_invoice` entry function.
 * Otherwise, creates the invoice and transfers it to the sender.
 */
export function buildCreateInvoiceTx(
  config: SweefiConfig,
  params: CreateInvoiceParams,
): Transaction {
  assertPositive(params.expectedAmount, "expectedAmount", "buildCreateInvoiceTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildCreateInvoiceTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  if (params.sendTo) {
    // Entry function — handles transfer internally
    tx.moveCall({
      target: `${config.packageId}::payment::create_and_send_invoice`,
      arguments: [
        tx.pure.address(params.recipient),
        tx.pure.u64(params.expectedAmount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.address(params.sendTo),
      ],
    });
  } else {
    // Public function — returns Invoice, transfer to sender
    const invoice = tx.moveCall({
      target: `${config.packageId}::payment::create_invoice`,
      arguments: [
        tx.pure.address(params.recipient),
        tx.pure.u64(params.expectedAmount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
      ],
    });
    tx.transferObjects([invoice], params.sender);
  }

  return tx;
}

/**
 * Build a PTB to pay an existing invoice.
 * Uses `pay_invoice_and_keep` entry — receipt auto-transferred to sender.
 * The Invoice object is consumed on-chain (replay protection).
 */
export function buildPayInvoiceTx(
  config: SweefiConfig,
  params: PayInvoiceParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildPayInvoiceTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::payment::pay_invoice_and_keep`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.invoiceId),
      coin,
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}
