import type { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import {
  MandateLevel,
  type CreateAgentMandateParams,
  type AgentMandatedPayParams,
  type UpgradeMandateLevelParams,
  type UpdateMandateCapsParams,
} from '../ptb/agent-mandate.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';

export class AgentMandateContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  create = (params: CreateAgentMandateParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    // V8 audit F-14: Guard against zero caps on L2+ mandates
    if (params.level >= MandateLevel.CAPPED && params.maxTotal === 0n) {
      throw new Error(
        '[sweefi] AgentMandate at L2+ with maxTotal=0 has zero lifetime budget (no spending possible). ' +
        "Use BigInt('18446744073709551615') (u64::MAX) for unlimited, or a specific cap for bounded spending.",
      );
    }

    tx.moveCall({
      target: `${this.#config.packageId}::agent_mandate::create_and_transfer`,
      typeArguments: [params.coinType],
      arguments: [
        tx.pure.address(params.delegate),
        tx.pure.u8(params.level),
        tx.pure.u64(params.maxPerTx),
        tx.pure.u64(params.dailyLimit),
        tx.pure.u64(params.weeklyLimit),
        tx.pure.u64(params.maxTotal),
        tx.pure.option('u64', params.expiresAtMs),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  pay = (params: AgentMandatedPayParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertFeeMicroPercent(params.feeMicroPercent, 'AgentMandateContract.pay');
    assertPositive(params.amount, 'amount', 'AgentMandateContract.pay');

    // Step 1: Validate with mandatory revocation check + debit
    tx.moveCall({
      target: `${this.#config.packageId}::agent_mandate::validate_and_spend`,
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

  upgradeLevel = (params: UpgradeMandateLevelParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::agent_mandate::upgrade_level`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.mandateId),
        tx.pure.u8(params.newLevel),
      ],
    });
  };

  updateCaps = (params: UpdateMandateCapsParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::agent_mandate::update_caps`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.mandateId),
        tx.pure.u64(params.maxPerTx),
        tx.pure.u64(params.dailyLimit),
        tx.pure.u64(params.weeklyLimit),
        tx.pure.u64(params.maxTotal),
      ],
    });
  };
}
