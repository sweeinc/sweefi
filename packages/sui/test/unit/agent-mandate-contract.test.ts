import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { AgentMandateContract } from '../../src/transactions/agentMandate';
import { SweefiPluginConfig } from '../../src/utils/config';
import {
  MandateLevel,
  type CreateAgentMandateParams,
  type AgentMandatedPayParams,
  type UpgradeMandateLevelParams,
  type UpdateMandateCapsParams,
} from '../../src/ptb/agent-mandate';

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
const contract = new AgentMandateContract(config);

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
// AgentMandateContract.create
// ══════════════════════════════════════════════════════════════

describe('AgentMandateContract.create', () => {
  it('produces a MoveCall for agent_mandate::create_and_transfer', () => {
    const tx = new Transaction();
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      level: MandateLevel.CAPPED,
      maxPerTx: 1_000_000_000n,
      dailyLimit: 5_000_000_000n,
      weeklyLimit: 20_000_000_000n,
      maxTotal: 100_000_000_000n,
      expiresAtMs: null,
    });

    const result = thunk(tx);
    expect(result).toBeUndefined();

    const mc = expectMoveCall(tx, 'agent_mandate', 'create_and_transfer');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('allows L0/L1 with maxTotal=0 (no spending needed)', () => {
    const tx = new Transaction();
    contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      level: MandateLevel.READ_ONLY,
      maxPerTx: 0n,
      dailyLimit: 0n,
      weeklyLimit: 0n,
      maxTotal: 0n,
      expiresAtMs: null,
    })(tx);

    expectMoveCall(tx, 'agent_mandate', 'create_and_transfer');
  });

  it('throws on L2+ with maxTotal=0 (zero budget trap)', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      level: MandateLevel.CAPPED,
      maxPerTx: 1_000_000_000n,
      dailyLimit: 5_000_000_000n,
      weeklyLimit: 20_000_000_000n,
      maxTotal: 0n,
      expiresAtMs: null,
    });
    expect(() => thunk(new Transaction())).toThrow(/maxTotal=0/);
  });

  it('throws on L3 with maxTotal=0', () => {
    const thunk = contract.create({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      delegate: DELEGATE,
      level: MandateLevel.AUTONOMOUS,
      maxPerTx: 1_000_000_000n,
      dailyLimit: 5_000_000_000n,
      weeklyLimit: 20_000_000_000n,
      maxTotal: 0n,
      expiresAtMs: null,
    });
    expect(() => thunk(new Transaction())).toThrow(/maxTotal=0/);
  });
});

// ══════════════════════════════════════════════════════════════
// AgentMandateContract.pay
// ══════════════════════════════════════════════════════════════

describe('AgentMandateContract.pay', () => {
  it('produces TWO MoveCalls: validate_and_spend + pay_and_keep', () => {
    const tx = new Transaction();
    contract.pay({
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

    expect(moveCalls[0].MoveCall.module).toBe('agent_mandate');
    expect(moveCalls[0].MoveCall.function).toBe('validate_and_spend');

    expect(moveCalls[1].MoveCall.module).toBe('payment');
    expect(moveCalls[1].MoveCall.function).toBe('pay_and_keep');
  });

  it('throws on zero amount', () => {
    const thunk = contract.pay({
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
    const thunk = contract.pay({
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
// AgentMandateContract.upgradeLevel
// ══════════════════════════════════════════════════════════════

describe('AgentMandateContract.upgradeLevel', () => {
  it('produces a MoveCall for agent_mandate::upgrade_level', () => {
    const tx = new Transaction();
    contract.upgradeLevel({
      sender: SENDER,
      mandateId: MANDATE_ID,
      coinType: SUI_COIN_TYPE,
      newLevel: MandateLevel.AUTONOMOUS,
    })(tx);

    expectMoveCall(tx, 'agent_mandate', 'upgrade_level');
  });
});

// ══════════════════════════════════════════════════════════════
// AgentMandateContract.updateCaps
// ══════════════════════════════════════════════════════════════

describe('AgentMandateContract.updateCaps', () => {
  it('produces a MoveCall for agent_mandate::update_caps', () => {
    const tx = new Transaction();
    contract.updateCaps({
      sender: SENDER,
      mandateId: MANDATE_ID,
      coinType: SUI_COIN_TYPE,
      maxPerTx: 2_000_000_000n,
      dailyLimit: 10_000_000_000n,
      weeklyLimit: 50_000_000_000n,
      maxTotal: 200_000_000_000n,
    })(tx);

    expectMoveCall(tx, 'agent_mandate', 'update_caps');
  });
});
