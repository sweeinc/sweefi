import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { EscrowContract } from '../../src/transactions/escrow';
import { SweefiPluginConfig } from '../../src/utils/config';
import type { CreateEscrowParams, EscrowOpParams } from '../../src/ptb/escrow';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const RECIPIENT = '0x' + '22'.repeat(32);
const FEE_RECIPIENT = '0x' + '33'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';
const PROTOCOL_STATE = '0x' + '99'.repeat(32);
const ESCROW_ID = '0x' + '44'.repeat(32);
const ARBITER = '0x' + '55'.repeat(32);

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  protocolState: PROTOCOL_STATE,
  network: 'testnet',
});
const contract = new EscrowContract(config);

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
// EscrowContract.create
// ══════════════════════════════════════════════════════════════

describe('EscrowContract.create', () => {
  it('produces a MoveCall for escrow::create', () => {
    const tx = new Transaction();
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 1_000_000_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    const mc = expectMoveCall(tx, 'escrow', 'create');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('supports string memo', () => {
    const tx = new Transaction();
    contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 1_000_000_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      memo: 'test escrow',
    })(tx);

    expectMoveCall(tx, 'escrow', 'create');
  });

  it('throws on zero depositAmount', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 0n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/depositAmount/);
  });

  it('throws on invalid feeMicroPercent', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 1_000_000_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 2_000_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowContract.release
// ══════════════════════════════════════════════════════════════

describe('EscrowContract.release', () => {
  it('produces a MoveCall for escrow::release_and_keep', () => {
    const tx = new Transaction();
    const result = contract.release({
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT,
    })(tx);

    expect(result).toBeUndefined();
    expectMoveCall(tx, 'escrow', 'release_and_keep');
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowContract.releaseComposable
// ══════════════════════════════════════════════════════════════

describe('EscrowContract.releaseComposable', () => {
  it('returns a TransactionResult for chaining', () => {
    const tx = new Transaction();
    const receipt = contract.releaseComposable({
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT,
    })(tx);

    expect(receipt).toBeDefined();
  });

  it('targets escrow::release (not release_and_keep)', () => {
    const tx = new Transaction();
    contract.releaseComposable({
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: RECIPIENT,
    })(tx);

    expectMoveCall(tx, 'escrow', 'release');
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowContract.refund
// ══════════════════════════════════════════════════════════════

describe('EscrowContract.refund', () => {
  it('produces a MoveCall for escrow::refund', () => {
    const tx = new Transaction();
    contract.refund({
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'escrow', 'refund');
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowContract.dispute
// ══════════════════════════════════════════════════════════════

describe('EscrowContract.dispute', () => {
  it('produces a MoveCall for escrow::dispute', () => {
    const tx = new Transaction();
    contract.dispute({
      coinType: SUI_COIN_TYPE,
      escrowId: ESCROW_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'escrow', 'dispute');
  });
});
