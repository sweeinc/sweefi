import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { AdminContract } from '../../src/transactions/admin';
import { SweefiPluginConfig } from '../../src/utils/config';
import type { AutoUnpauseParams } from '../../src/ptb/admin';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';
const PROTOCOL_STATE = '0x' + '99'.repeat(32);
const ADMIN_CAP = '0x' + '88'.repeat(32);

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  protocolState: PROTOCOL_STATE,
  adminCap: ADMIN_CAP,
  network: 'testnet',
});
const contract = new AdminContract(config);

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
// AdminContract.pause
// ══════════════════════════════════════════════════════════════

describe('AdminContract.pause', () => {
  it('produces a MoveCall for admin::pause', () => {
    const tx = new Transaction();
    const thunk = contract.pause({
      adminCapId: ADMIN_CAP,
      sender: SENDER,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    expectMoveCall(tx, 'admin', 'pause');
  });

  it('works with tx.add()', () => {
    const tx = new Transaction();
    tx.add(contract.pause({
      adminCapId: ADMIN_CAP,
      sender: SENDER,
    }));

    expectMoveCall(tx, 'admin', 'pause');
  });
});

// ══════════════════════════════════════════════════════════════
// AdminContract.unpause
// ══════════════════════════════════════════════════════════════

describe('AdminContract.unpause', () => {
  it('produces a MoveCall for admin::unpause', () => {
    const tx = new Transaction();
    contract.unpause({
      adminCapId: ADMIN_CAP,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'admin', 'unpause');
  });
});

// ══════════════════════════════════════════════════════════════
// AdminContract.autoUnpause
// ══════════════════════════════════════════════════════════════

describe('AdminContract.autoUnpause', () => {
  it('produces a MoveCall for admin::auto_unpause (no adminCap needed)', () => {
    const tx = new Transaction();
    contract.autoUnpause({
      sender: SENDER,
    })(tx);

    const mc = expectMoveCall(tx, 'admin', 'auto_unpause');
    // auto_unpause has no type arguments
    expect(mc.MoveCall.typeArguments).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// AdminContract.burnCap
// ══════════════════════════════════════════════════════════════

describe('AdminContract.burnCap', () => {
  it('produces a MoveCall for admin::burn_admin_cap', () => {
    const tx = new Transaction();
    contract.burnCap({
      adminCapId: ADMIN_CAP,
      sender: SENDER,
    })(tx);

    expectMoveCall(tx, 'admin', 'burn_admin_cap');
  });
});

// ══════════════════════════════════════════════════════════════
// AdminContract without protocolState
// ══════════════════════════════════════════════════════════════

describe('AdminContract without protocolState', () => {
  it('throws when protocolState is missing', () => {
    // Use mainnet (no defaults) to avoid testnet auto-fill
    const badConfig = new SweefiPluginConfig({
      packageId: PACKAGE_ID,
      network: 'mainnet',
    });
    const badContract = new AdminContract(badConfig);

    const thunk = badContract.pause({
      adminCapId: ADMIN_CAP,
      sender: SENDER,
    });
    expect(() => thunk(new Transaction())).toThrow();
  });
});
