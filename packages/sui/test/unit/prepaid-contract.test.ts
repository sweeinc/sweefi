import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { PrepaidContract } from '../../src/transactions/prepaid';
import { SweefiPluginConfig } from '../../src/utils/config';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const PROVIDER = '0x' + '22'.repeat(32);
const FEE_RECIPIENT = '0x' + '33'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';
const PROTOCOL_STATE = '0x' + '99'.repeat(32);
const BALANCE_ID = '0x' + '44'.repeat(32);

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  protocolState: PROTOCOL_STATE,
  network: 'testnet',
});
const contract = new PrepaidContract(config);

function expectMoveCall(tx: Transaction, module: string, fn: string) {
  const data = tx.getData();
  const moveCall = data.commands.find(
    (c: any) => c.$kind === 'MoveCall',
  );
  expect(moveCall, `expected a MoveCall for ${module}::${fn}`).toBeDefined();
  expect(moveCall!.MoveCall.module).toBe(module);
  expect(moveCall!.MoveCall.function).toBe(fn);
  return moveCall!;
}

// ══════════════════════════════════════════════════════════════
// PrepaidContract.deposit
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.deposit', () => {
  it('produces a MoveCall for prepaid::deposit', () => {
    const tx = new Transaction();
    const thunk = contract.deposit({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      provider: PROVIDER,
      amount: 1_000_000_000n,
      ratePerCall: 100_000n,
      withdrawalDelayMs: 60_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    const mc = expectMoveCall(tx, 'prepaid', 'deposit');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('throws on zero amount', () => {
    const thunk = contract.deposit({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      provider: PROVIDER,
      amount: 0n,
      ratePerCall: 100_000n,
      withdrawalDelayMs: 60_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/amount/);
  });

  it('throws on zero ratePerCall', () => {
    const thunk = contract.deposit({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      provider: PROVIDER,
      amount: 1_000_000_000n,
      ratePerCall: 0n,
      withdrawalDelayMs: 60_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/ratePerCall/);
  });

  it('throws on invalid feeMicroPercent', () => {
    const thunk = contract.deposit({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      provider: PROVIDER,
      amount: 1_000_000_000n,
      ratePerCall: 100_000n,
      withdrawalDelayMs: 60_000n,
      feeMicroPercent: 2_000_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.claim
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.claim', () => {
  it('produces a MoveCall for prepaid::claim', () => {
    const tx = new Transaction();
    contract.claim({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: PROVIDER,
      cumulativeCallCount: 10n,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'claim');
  });

  it('returns void (non-composable)', () => {
    const tx = new Transaction();
    const result = contract.claim({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: PROVIDER,
      cumulativeCallCount: 5n,
    })(tx);
    expect(result).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.requestWithdrawal
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.requestWithdrawal', () => {
  it('produces a MoveCall for prepaid::request_withdrawal', () => {
    const tx = new Transaction();
    contract.requestWithdrawal({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'request_withdrawal');
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.finalizeWithdrawal
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.finalizeWithdrawal', () => {
  it('produces a MoveCall for prepaid::finalize_withdrawal', () => {
    const tx = new Transaction();
    contract.finalizeWithdrawal({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'finalize_withdrawal');
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.cancelWithdrawal
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.cancelWithdrawal', () => {
  it('produces a MoveCall for prepaid::cancel_withdrawal', () => {
    const tx = new Transaction();
    contract.cancelWithdrawal({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'cancel_withdrawal');
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.topUp
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.topUp', () => {
  it('produces a MoveCall for prepaid::top_up', () => {
    const tx = new Transaction();
    contract.topUp({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
      amount: 500_000_000n,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'top_up');
  });

  it('throws on zero amount', () => {
    const thunk = contract.topUp({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
      amount: 0n,
    });
    expect(() => thunk(new Transaction())).toThrow(/amount/);
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.agentClose
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.agentClose', () => {
  it('produces a MoveCall for prepaid::agent_close', () => {
    const tx = new Transaction();
    contract.agentClose({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'agent_close');
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidContract.providerClose
// ══════════════════════════════════════════════════════════════

describe('PrepaidContract.providerClose', () => {
  it('produces a MoveCall for prepaid::provider_close', () => {
    const tx = new Transaction();
    contract.providerClose({
      coinType: SUI_COIN_TYPE,
      balanceId: BALANCE_ID,
      sender: PROVIDER,
    })(tx);

    expectMoveCall(tx, 'prepaid', 'provider_close');
  });
});
