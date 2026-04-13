import type { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type { CreateUptoDepositParams, SettleUptoParams, ExpireUptoParams } from '../ptb/upto.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

export class UptoContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  create = (params: CreateUptoDepositParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.maxAmount, 'maxAmount', 'UptoContract.create');
    assertFeeMicroPercent(params.feeMicroPercent, 'UptoContract.create');

    if (params.settlementCeiling !== undefined) {
      if (params.settlementCeiling < 1n || params.settlementCeiling > params.maxAmount) {
        throw new Error(
          `UptoContract.create: settlementCeiling must be 1 <= ceiling <= maxAmount ` +
          `(got ceiling=${params.settlementCeiling}, maxAmount=${params.maxAmount})`,
        );
      }
    }

    const protocolState = this.#config.requireProtocolState();
    const deposit = coinWithBalance({ type: params.coinType, balance: params.maxAmount });

    // Move create() derives max_amount from deposit.value() — do NOT pass maxAmount as an argument.
    // Argument order must match the Move function signature exactly (BCS is positional).
    if (params.settlementCeiling !== undefined) {
      // create_with_ceiling(deposit, recipient, settlement_ceiling, deadline, fee, fee_recipient, state, clock)
      tx.moveCall({
        target: `${this.#config.packageId}::upto_deposit::create_with_ceiling`,
        typeArguments: [params.coinType],
        arguments: [
          deposit,
          tx.pure.address(params.recipient),
          tx.pure.u64(params.settlementCeiling),
          tx.pure.u64(params.settlementDeadlineMs),
          tx.pure.u64(params.feeMicroPercent),
          tx.pure.address(params.feeRecipient),
          tx.object(protocolState),
          tx.object(this.#config.SUI_CLOCK),
        ],
      });
    } else {
      // create(deposit, recipient, deadline, fee, fee_recipient, state, clock)
      tx.moveCall({
        target: `${this.#config.packageId}::upto_deposit::create`,
        typeArguments: [params.coinType],
        arguments: [
          deposit,
          tx.pure.address(params.recipient),
          tx.pure.u64(params.settlementDeadlineMs),
          tx.pure.u64(params.feeMicroPercent),
          tx.pure.address(params.feeRecipient),
          tx.object(protocolState),
          tx.object(this.#config.SUI_CLOCK),
        ],
      });
    }
  };

  settle = (params: SettleUptoParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.actualAmount, 'actualAmount', 'UptoContract.settle');

    tx.moveCall({
      target: `${this.#config.packageId}::upto_deposit::settle`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.depositId),
        tx.pure.u64(params.actualAmount),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  expire = (params: ExpireUptoParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::upto_deposit::expire`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.depositId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };
}
