import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { MandateContract } from '../../src/transactions/mandate';
import { SweefiPluginConfig } from '../../src/utils/config';
import type {
  CreateMandateParams,
  MandatedPayParams,
  RevokeMandateParams,
  CreateRegistryParams,
} from '../../src/ptb/mandate';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const RECIPIENT = '0x' + '22'.repeat(32);
const FEE_RECIPIENT = '0x' + '33'.repeat(32);
const DELEGATE = '0x' + '44'.repeat(32);
const MANDATE_ID = '0x' + '55'.repeat(32);
const REGISTRY_ID = '0x' + '66'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  network: 'testnet',
});
const contract = new MandateContract(config);

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
// MandateContract.create
// ══════════════════════════════════════════════════════════════

describe('MandateContract.create', () => {
  it('produces a MoveCall for mandate::create_and_transfer', () => {
    const tx = new Transaction();
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: null,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    const mc = expectMoveCall(tx, 'mandate', 'create_and_transfer');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('supports expiry timestamp', () => {
    const tx = new Transaction();
    contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: BigInt(Date.now() + 86_400_000),
    })(tx);

    expectMoveCall(tx, 'mandate', 'create_and_transfer');
  });
});

// ══════════════════════════════════════════════════════════════
// MandateContract.mandatedPay
// ══════════════════════════════════════════════════════════════

describe('MandateContract.mandatedPay', () => {
  it('produces TWO MoveCalls: validate_and_spend + pay_and_keep', () => {
    const tx = new Transaction();
    contract.mandatedPay({
      coinType: SUI_COIN_TYPE,
      sender: DELEGATE,
      recipient: RECIPIENT,
      amount: 500_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      mandateId: MANDATE_ID,
      registryId: REGISTRY_ID,
    })(tx);

    const data = tx.getData();
    const moveCalls = data.commands.filter((c: any) => c.$kind === 'MoveCall');
    expect(moveCalls.length).toBeGreaterThanOrEqual(2);

    expect(moveCalls[0].MoveCall.module).toBe('mandate');
    expect(moveCalls[0].MoveCall.function).toBe('validate_and_spend');

    expect(moveCalls[1].MoveCall.module).toBe('payment');
    expect(moveCalls[1].MoveCall.function).toBe('pay_and_keep');
  });

  it('throws on zero amount', () => {
    const thunk = contract.mandatedPay({
      coinType: SUI_COIN_TYPE,
      sender: DELEGATE,
      recipient: RECIPIENT,
      amount: 0n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      mandateId: MANDATE_ID,
      registryId: REGISTRY_ID,
    });
    expect(() => thunk(new Transaction())).toThrow(/amount/);
  });

  it('throws on invalid feeMicroPercent', () => {
    const thunk = contract.mandatedPay({
      coinType: SUI_COIN_TYPE,
      sender: DELEGATE,
      recipient: RECIPIENT,
      amount: 500_000_000n,
      feeMicroPercent: 2_000_000,
      feeRecipient: FEE_RECIPIENT,
      mandateId: MANDATE_ID,
      registryId: REGISTRY_ID,
    });
    expect(() => thunk(new Transaction())).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// MandateContract.revoke
// ══════════════════════════════════════════════════════════════

describe('MandateContract.revoke', () => {
  it('produces a MoveCall for mandate::revoke', () => {
    const tx = new Transaction();
    contract.revoke({
      sender: SENDER,
      registryId: REGISTRY_ID,
      mandateId: MANDATE_ID,
      coinType: SUI_COIN_TYPE,
    })(tx);

    expectMoveCall(tx, 'mandate', 'revoke');
  });
});

// ══════════════════════════════════════════════════════════════
// MandateContract.createRegistry
// ══════════════════════════════════════════════════════════════

describe('MandateContract.createRegistry', () => {
  it('produces a MoveCall for mandate::create_registry', () => {
    const tx = new Transaction();
    contract.createRegistry({
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'mandate', 'create_registry');
  });
});
