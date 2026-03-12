import type { Transaction } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type { AdminParams } from '../ptb/types.js';
import type { AutoUnpauseParams } from '../ptb/admin.js';

export class AdminContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  pause = (params: AdminParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    const protocolState = this.#config.requireProtocolState();

    tx.moveCall({
      target: `${this.#config.packageId}::admin::pause`,
      arguments: [
        tx.object(params.adminCapId),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  unpause = (params: AdminParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    const protocolState = this.#config.requireProtocolState();

    tx.moveCall({
      target: `${this.#config.packageId}::admin::unpause`,
      arguments: [
        tx.object(params.adminCapId),
        tx.object(protocolState),
      ],
    });
  };

  autoUnpause = (params: AutoUnpauseParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    const protocolState = this.#config.requireProtocolState();

    tx.moveCall({
      target: `${this.#config.packageId}::admin::auto_unpause`,
      arguments: [
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  burnCap = (params: AdminParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    const protocolState = this.#config.requireProtocolState();

    tx.moveCall({
      target: `${this.#config.packageId}::admin::burn_admin_cap`,
      arguments: [
        tx.object(params.adminCapId),
        tx.object(protocolState),
      ],
    });
  };
}
