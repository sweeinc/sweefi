import type { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { TransactionBuilderConfig } from '../utils/config.js';
import type {
  PrepaidDepositParams,
  PrepaidClaimParams,
  PrepaidOpParams,
  PrepaidTopUpParams,
  PrepaidDepositWithReceiptsParams,
  PrepaidFinalizeClaimParams,
  PrepaidDisputeClaimParams,
  PrepaidWithdrawDisputedParams,
} from '../ptb/types.js';
import { assertFeeMicroPercent, assertPositive } from '../ptb/assert.js';
import { UNLIMITED_CALLS } from '../ptb/prepaid.js';

/** Convert hex string (with optional 0x prefix) to number array for tx.pure */
function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error(
      `hexToBytes: hex string has odd length (${clean.length} chars). ` +
      'Each byte requires exactly 2 hex characters.',
    );
  }
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('hexToBytes: hex string contains non-hex characters.');
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

export class PrepaidContract {
  #config: TransactionBuilderConfig;

  constructor(config: TransactionBuilderConfig) {
    this.#config = config;
  }

  deposit = (params: PrepaidDepositParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PrepaidContract.deposit');
    assertPositive(params.ratePerCall, 'ratePerCall', 'PrepaidContract.deposit');
    assertFeeMicroPercent(params.feeMicroPercent, 'PrepaidContract.deposit');

    const protocolState = this.#config.requireProtocolState();
    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::deposit`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.provider),
        tx.pure.u64(params.ratePerCall),
        tx.pure.u64(params.maxCalls ?? UNLIMITED_CALLS),
        tx.pure.u64(params.withdrawalDelayMs),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  depositWithReceipts = (params: PrepaidDepositWithReceiptsParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PrepaidContract.depositWithReceipts');
    assertPositive(params.ratePerCall, 'ratePerCall', 'PrepaidContract.depositWithReceipts');
    assertFeeMicroPercent(params.feeMicroPercent, 'PrepaidContract.depositWithReceipts');

    const protocolState = this.#config.requireProtocolState();
    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::deposit_with_receipts`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.provider),
        tx.pure.u64(params.ratePerCall),
        tx.pure.u64(params.maxCalls ?? UNLIMITED_CALLS),
        tx.pure.u64(params.withdrawalDelayMs),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure('vector<u8>', hexToBytes(params.providerPubkey)),
        tx.pure.u64(params.disputeWindowMs),
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  claim = (params: PrepaidClaimParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::claim`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.pure.u64(params.cumulativeCallCount),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  requestWithdrawal = (params: PrepaidOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::request_withdrawal`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  finalizeWithdrawal = (params: PrepaidOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::finalize_withdrawal`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  cancelWithdrawal = (params: PrepaidOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::cancel_withdrawal`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
      ],
    });
  };

  agentClose = (params: PrepaidOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::agent_close`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  providerClose = (params: PrepaidOpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::provider_close`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  topUp = (params: PrepaidTopUpParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    assertPositive(params.amount, 'amount', 'PrepaidContract.topUp');

    const protocolState = this.#config.requireProtocolState();
    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::top_up`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        coin,
        tx.object(protocolState),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  finalizeClaim = (params: PrepaidFinalizeClaimParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::finalize_claim`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  disputeClaim = (params: PrepaidDisputeClaimParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::dispute_claim`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.pure.address(params.receiptBalanceId),
        tx.pure.u64(params.receiptCallNumber),
        tx.pure.u64(params.receiptTimestampMs),
        tx.pure('vector<u8>', Array.from(params.receiptResponseHash)),
        tx.pure('vector<u8>', Array.from(params.signature)),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  withdrawDisputed = (params: PrepaidWithdrawDisputedParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    tx.moveCall({
      target: `${this.#config.packageId}::prepaid::withdraw_disputed`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.balanceId),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };
}
