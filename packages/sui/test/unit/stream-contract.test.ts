import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { StreamContract } from '../../src/transactions/stream';
import { SweefiPluginConfig } from '../../src/utils/config';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const RECIPIENT = '0x' + '22'.repeat(32);
const FEE_RECIPIENT = '0x' + '33'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';
const PROTOCOL_STATE = '0x' + '99'.repeat(32);
const METER_ID = '0x' + '44'.repeat(32);

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  protocolState: PROTOCOL_STATE,
  network: 'testnet',
});
const contract = new StreamContract(config);

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
// StreamContract.create
// ══════════════════════════════════════════════════════════════

describe('StreamContract.create', () => {
  it('produces a MoveCall for stream::create', () => {
    const tx = new Transaction();
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 1_000_000_000n,
      ratePerSecond: 1_000n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    const mc = expectMoveCall(tx, 'stream', 'create');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('throws on zero depositAmount', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 0n,
      ratePerSecond: 1_000n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/depositAmount/);
  });

  it('throws on zero ratePerSecond', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 1_000_000_000n,
      ratePerSecond: 0n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/ratePerSecond/);
  });

  it('throws on invalid feeMicroPercent', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 1_000_000_000n,
      ratePerSecond: 1_000n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 2_000_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.createWithTimeout
// ══════════════════════════════════════════════════════════════

describe('StreamContract.createWithTimeout', () => {
  it('produces a MoveCall for stream::create_with_timeout', () => {
    const tx = new Transaction();
    contract.createWithTimeout({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 1_000_000_000n,
      ratePerSecond: 1_000n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 86_400_000n,
    })(tx);

    expectMoveCall(tx, 'stream', 'create_with_timeout');
  });

  it('throws on zero depositAmount', () => {
    const thunk = contract.createWithTimeout({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      depositAmount: 0n,
      ratePerSecond: 1_000n,
      budgetCap: 10_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 86_400_000n,
    });
    expect(() => thunk(new Transaction())).toThrow(/depositAmount/);
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.claim
// ══════════════════════════════════════════════════════════════

describe('StreamContract.claim', () => {
  it('produces a MoveCall for stream::claim', () => {
    const tx = new Transaction();
    contract.claim({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: RECIPIENT,
    })(tx);

    const mc = expectMoveCall(tx, 'stream', 'claim');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('returns void (non-composable)', () => {
    const tx = new Transaction();
    const result = contract.claim({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: RECIPIENT,
    })(tx);
    expect(result).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.batchClaim
// ══════════════════════════════════════════════════════════════

describe('StreamContract.batchClaim', () => {
  it('produces multiple stream::claim MoveCalls', () => {
    const tx = new Transaction();
    const meterIds = [METER_ID, '0x' + '55'.repeat(32), '0x' + '66'.repeat(32)];
    contract.batchClaim({
      coinType: SUI_COIN_TYPE,
      meterIds,
      sender: RECIPIENT,
    })(tx);

    const data = tx.getData();
    const moveCalls = data.commands.filter(
      (c: any) => c.$kind === 'MoveCall' && c.MoveCall.function === 'claim',
    );
    expect(moveCalls.length).toBe(3);
  });

  it('throws on empty meterIds', () => {
    const thunk = contract.batchClaim({
      coinType: SUI_COIN_TYPE,
      meterIds: [],
      sender: RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/meterIds must not be empty/);
  });

  it('throws on >512 meterIds', () => {
    const thunk = contract.batchClaim({
      coinType: SUI_COIN_TYPE,
      meterIds: Array.from({ length: 513 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`),
      sender: RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/max 512/);
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.pause
// ══════════════════════════════════════════════════════════════

describe('StreamContract.pause', () => {
  it('produces a MoveCall for stream::pause', () => {
    const tx = new Transaction();
    contract.pause({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'stream', 'pause');
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.resume
// ══════════════════════════════════════════════════════════════

describe('StreamContract.resume', () => {
  it('produces a MoveCall for stream::resume', () => {
    const tx = new Transaction();
    contract.resume({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'stream', 'resume');
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.close
// ══════════════════════════════════════════════════════════════

describe('StreamContract.close', () => {
  it('produces a MoveCall for stream::close', () => {
    const tx = new Transaction();
    contract.close({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'stream', 'close');
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.recipientClose
// ══════════════════════════════════════════════════════════════

describe('StreamContract.recipientClose', () => {
  it('produces a MoveCall for stream::recipient_close', () => {
    const tx = new Transaction();
    contract.recipientClose({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: RECIPIENT,
    })(tx);

    expectMoveCall(tx, 'stream', 'recipient_close');
  });
});

// ══════════════════════════════════════════════════════════════
// StreamContract.topUp
// ══════════════════════════════════════════════════════════════

describe('StreamContract.topUp', () => {
  it('produces a MoveCall for stream::top_up', () => {
    const tx = new Transaction();
    contract.topUp({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
      depositAmount: 500_000_000n,
    })(tx);

    expectMoveCall(tx, 'stream', 'top_up');
  });

  it('throws on zero depositAmount', () => {
    const thunk = contract.topUp({
      coinType: SUI_COIN_TYPE,
      meterId: METER_ID,
      sender: SENDER,
      depositAmount: 0n,
    });
    expect(() => thunk(new Transaction())).toThrow(/depositAmount/);
  });
});
