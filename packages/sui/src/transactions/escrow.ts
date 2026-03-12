import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type { CreateEscrowParams, EscrowOpParams } from '../ptb/escrow.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

export class EscrowContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  create = (params: CreateEscrowParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.depositAmount, 'depositAmount', 'EscrowContract.create');
    assertFeeMicroPercent(params.feeMicroPercent, 'EscrowContract.create');

    const protocolState = this.#config.requireProtocolState();

    const memo = typeof params.memo === 'string'
      ? new TextEncoder().encode(params.memo)
      : params.memo ?? new Uint8Array();

    const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

    tx.moveCall({
      target: `${this.#config.packageId}::escrow::create`,
      typeArguments: [params.coinType],
      arguments: [
        deposit,
        tx.pure.address(params.seller),
        tx.pure.address(params.arbiter),
        tx.pure.u64(params.deadlineMs),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.vector('u8', Array.from(memo)),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  release = (params: EscrowOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::escrow::release_and_keep`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.escrowId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  releaseComposable = (params: EscrowOpParams): ((tx: Transaction) => TransactionResult) => (tx: Transaction) => {
    return tx.moveCall({
      target: `${this.#config.packageId}::escrow::release`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.escrowId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  refund = (params: EscrowOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::escrow::refund`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.escrowId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  dispute = (params: EscrowOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::escrow::dispute`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.escrowId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };
}
