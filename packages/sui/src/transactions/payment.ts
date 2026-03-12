import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type { PayParams, CreateInvoiceParams, PayInvoiceParams } from '../ptb/types.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

/**
 * Payment transaction builders following the DeepBook curried pattern:
 *   method = (params) => (tx: Transaction) => void
 *
 * Each method returns a thunk compatible with `tx.add()`.
 */
export class PaymentContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  /**
   * Direct payment with fee split. Receipt auto-transferred to sender.
   * @returns Thunk that mutates the transaction (use with tx.add() or call directly)
   */
  pay = (params: PayParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PaymentContract.pay');
    assertFeeMicroPercent(params.feeMicroPercent, 'PaymentContract.pay');

    const memo = typeof params.memo === 'string'
      ? new TextEncoder().encode(params.memo)
      : params.memo ?? new Uint8Array();

    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::payment::pay_and_keep`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.amount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.vector('u8', Array.from(memo)),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  /**
   * Composable payment — returns receipt TransactionResult for use in same PTB.
   * Example: atomic pay + SEAL access in one transaction.
   *
   *   const receipt = tx.add(client.sweefi.payment.payComposable({ ... }));
   */
  payComposable = (params: PayParams): ((tx: Transaction) => TransactionResult) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PaymentContract.payComposable');
    assertFeeMicroPercent(params.feeMicroPercent, 'PaymentContract.payComposable');

    const memo = typeof params.memo === 'string'
      ? new TextEncoder().encode(params.memo)
      : params.memo ?? new Uint8Array();

    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    return tx.moveCall({
      target: `${this.#config.packageId}::payment::pay`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.amount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.vector('u8', Array.from(memo)),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  /**
   * Create an invoice. If sendTo is provided, uses the entry function
   * that transfers internally. Otherwise creates + returns for manual transfer.
   */
  createInvoice = (params: CreateInvoiceParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.expectedAmount, 'expectedAmount', 'PaymentContract.createInvoice');
    assertFeeMicroPercent(params.feeMicroPercent, 'PaymentContract.createInvoice');

    if (params.sendTo) {
      tx.moveCall({
        target: `${this.#config.packageId}::payment::create_and_send_invoice`,
        arguments: [
          tx.pure.address(params.recipient),
          tx.pure.u64(params.expectedAmount),
          tx.pure.u64(params.feeMicroPercent),
          tx.pure.address(params.feeRecipient),
          tx.pure.address(params.sendTo),
        ],
      });
    } else {
      const invoice = tx.moveCall({
        target: `${this.#config.packageId}::payment::create_invoice`,
        arguments: [
          tx.pure.address(params.recipient),
          tx.pure.u64(params.expectedAmount),
          tx.pure.u64(params.feeMicroPercent),
          tx.pure.address(params.feeRecipient),
        ],
      });
      tx.transferObjects([invoice], params.sender);
    }
  };

  /**
   * Pay an existing invoice. Invoice is consumed on-chain (replay protection).
   */
  payInvoice = (params: PayInvoiceParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PaymentContract.payInvoice');

    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::payment::pay_invoice_and_keep`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.invoiceId),
        coin,
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };
}
