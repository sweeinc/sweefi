import type { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type { PayParams } from '../ptb/types.js';
import type {
  CreateMandateParams,
  MandatedPayParams,
  RevokeMandateParams,
  CreateRegistryParams,
} from '../ptb/mandate.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

export class MandateContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  create = (params: CreateMandateParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::mandate::create_and_transfer`,
      typeArguments: [params.coinType],
      arguments: [
        tx.pure.address(params.delegate),
        tx.pure.u64(params.maxPerTx),
        tx.pure.u64(params.maxTotal),
        tx.pure.option('u64', params.expiresAtMs),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  mandatedPay = (params: MandatedPayParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertFeeMicroPercent(params.feeMicroPercent, 'MandateContract.mandatedPay');
    assertPositive(params.amount, 'amount', 'MandateContract.mandatedPay');

    // Step 1: Validate and debit the mandate
    tx.moveCall({
      target: `${this.#config.packageId}::mandate::validate_and_spend`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.mandateId),
        tx.pure.u64(params.amount),
        tx.object(params.registryId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });

    // Step 2: Execute the payment
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

  revoke = (params: RevokeMandateParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::mandate::revoke`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.registryId),
        tx.pure.id(params.mandateId),
      ],
    });
  };

  createRegistry = (params: CreateRegistryParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::mandate::create_registry`,
      arguments: [],
    });
  };
}
