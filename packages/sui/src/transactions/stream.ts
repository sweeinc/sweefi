import type { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type {
  CreateStreamParams,
  CreateStreamWithTimeoutParams,
  StreamOpParams,
  StreamTopUpParams,
  BatchClaimParams,
} from '../ptb/types.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

export class StreamContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  create = (params: CreateStreamParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.depositAmount, 'depositAmount', 'StreamContract.create');
    assertPositive(params.ratePerSecond, 'ratePerSecond', 'StreamContract.create');
    assertFeeMicroPercent(params.feeMicroPercent, 'StreamContract.create');

    const protocolState = this.#config.requireProtocolState();
    const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

    tx.moveCall({
      target: `${this.#config.packageId}::stream::create`,
      typeArguments: [params.coinType],
      arguments: [
        deposit,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.ratePerSecond),
        tx.pure.u64(params.budgetCap),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  createWithTimeout = (params: CreateStreamWithTimeoutParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.depositAmount, 'depositAmount', 'StreamContract.createWithTimeout');
    assertPositive(params.ratePerSecond, 'ratePerSecond', 'StreamContract.createWithTimeout');
    assertFeeMicroPercent(params.feeMicroPercent, 'StreamContract.createWithTimeout');

    const protocolState = this.#config.requireProtocolState();
    const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

    tx.moveCall({
      target: `${this.#config.packageId}::stream::create_with_timeout`,
      typeArguments: [params.coinType],
      arguments: [
        deposit,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.ratePerSecond),
        tx.pure.u64(params.budgetCap),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.u64(params.recipientCloseTimeoutMs),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  claim = (params: StreamOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::stream::claim`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  batchClaim = (params: BatchClaimParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    if (params.meterIds.length === 0) {
      throw new Error('StreamContract.batchClaim: meterIds must not be empty');
    }
    if (params.meterIds.length > 512) {
      throw new Error('StreamContract.batchClaim: max 512 streams per batch (Sui PTB command limit)');
    }

    for (const meterId of params.meterIds) {
      tx.moveCall({
        target: `${this.#config.packageId}::stream::claim`,
        typeArguments: [params.coinType],
        arguments: [
          tx.object(meterId),
          tx.object(this.#config.SUI_CLOCK),
        ],
      });
    }
  };

  pause = (params: StreamOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::stream::pause`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  resume = (params: StreamOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::stream::resume`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  close = (params: StreamOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::stream::close`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  recipientClose = (params: StreamOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::stream::recipient_close`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  topUp = (params: StreamTopUpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.depositAmount, 'depositAmount', 'StreamContract.topUp');

    const protocolState = this.#config.requireProtocolState();
    const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

    tx.moveCall({
      target: `${this.#config.packageId}::stream::top_up`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.meterId),
        deposit,
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };
}
