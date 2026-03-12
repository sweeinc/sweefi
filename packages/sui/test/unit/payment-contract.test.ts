import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { PaymentContract } from '../../src/transactions/payment';
import { SweefiPluginConfig } from '../../src/utils/config';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);
const SENDER = '0x' + '11'.repeat(32);
const RECIPIENT = '0x' + '22'.repeat(32);
const FEE_RECIPIENT = '0x' + '33'.repeat(32);
const INVOICE_ID = '0x' + '55'.repeat(32);
const SUI_COIN_TYPE = '0x2::sui::SUI';

const config = new SweefiPluginConfig({
  packageId: PACKAGE_ID,
  network: 'testnet',
});
const contract = new PaymentContract(config);

/** Find the first MoveCall command and assert module::function */
function expectMoveCall(tx: Transaction, module: string, fn: string) {
  const data = tx.getData();
  const moveCall = data.commands.find(
    (c: any) => c.$kind === 'MoveCall',
  );
  expect(moveCall, `expected a MoveCall command`).toBeDefined();
  expect(moveCall!.MoveCall.module).toBe(module);
  expect(moveCall!.MoveCall.function).toBe(fn);
  return moveCall!;
}

// ══════════════════════════════════════════════════════════════
// PaymentContract.pay
// ══════════════════════════════════════════════════════════════

describe('PaymentContract.pay', () => {
  it('produces a thunk that adds correct moveCall', () => {
    const tx = new Transaction();
    const thunk = contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    // Thunk returns void (non-composable)
    const result = thunk(tx);
    expect(result).toBeUndefined();

    const data = tx.getData();
    expect(data.commands.length).toBeGreaterThanOrEqual(2);

    const mc = expectMoveCall(tx, 'payment', 'pay_and_keep');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });

  it('works with tx.add()', () => {
    const tx = new Transaction();
    tx.add(contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    }));

    expectMoveCall(tx, 'payment', 'pay_and_keep');
  });

  it('encodes string memo as UTF-8 bytes', () => {
    const tx = new Transaction();
    contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: 'hello',
    })(tx);

    const data = tx.getData();
    expect(data.commands.length).toBeGreaterThanOrEqual(2);
  });

  it('handles Uint8Array memo', () => {
    const tx = new Transaction();
    contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: new Uint8Array([1, 2, 3]),
    })(tx);

    const data = tx.getData();
    expect(data.commands.length).toBeGreaterThanOrEqual(2);
  });

  it('throws on zero amount', () => {
    const thunk = contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 0n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/amount must be > 0/);
  });

  it('throws on negative amount', () => {
    const thunk = contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: -1n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/amount must be > 0/);
  });

  it('throws on invalid feeMicroPercent', () => {
    const thunk = contract.pay({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000n,
      feeMicroPercent: 2_000_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// PaymentContract.payComposable
// ══════════════════════════════════════════════════════════════

describe('PaymentContract.payComposable', () => {
  it('returns a TransactionResult for chaining', () => {
    const tx = new Transaction();
    const thunk = contract.payComposable({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    });

    const receipt = thunk(tx);
    expect(receipt).toBeDefined();
  });

  it('targets payment::pay (not pay_and_keep)', () => {
    const tx = new Transaction();
    contract.payComposable({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      recipient: RECIPIENT,
      amount: 1_000_000_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
    })(tx);

    expectMoveCall(tx, 'payment', 'pay');
  });
});

// ══════════════════════════════════════════════════════════════
// PaymentContract.createInvoice
// ══════════════════════════════════════════════════════════════

describe('PaymentContract.createInvoice', () => {
  it('uses create_and_send_invoice when sendTo provided', () => {
    const tx = new Transaction();
    contract.createInvoice({
      sender: SENDER,
      recipient: RECIPIENT,
      expectedAmount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      sendTo: RECIPIENT,
    })(tx);

    expectMoveCall(tx, 'payment', 'create_and_send_invoice');
  });

  it('uses create_invoice + transferObjects when no sendTo', () => {
    const tx = new Transaction();
    contract.createInvoice({
      sender: SENDER,
      recipient: RECIPIENT,
      expectedAmount: 1_000_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    })(tx);

    expectMoveCall(tx, 'payment', 'create_invoice');

    const data = tx.getData();
    const transfer = data.commands.find(
      (c: any) => c.$kind === 'TransferObjects',
    );
    expect(transfer).toBeDefined();
  });

  it('throws on zero expectedAmount', () => {
    const thunk = contract.createInvoice({
      sender: SENDER,
      recipient: RECIPIENT,
      expectedAmount: 0n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    expect(() => thunk(new Transaction())).toThrow(/expectedAmount must be > 0/);
  });
});

// ══════════════════════════════════════════════════════════════
// PaymentContract.payInvoice
// ══════════════════════════════════════════════════════════════

describe('PaymentContract.payInvoice', () => {
  it('targets pay_invoice_and_keep', () => {
    const tx = new Transaction();
    contract.payInvoice({
      coinType: SUI_COIN_TYPE,
      sender: SENDER,
      invoiceId: INVOICE_ID,
      amount: 1_000_000n,
    })(tx);

    const mc = expectMoveCall(tx, 'payment', 'pay_invoice_and_keep');
    expect(mc.MoveCall.typeArguments).toEqual([SUI_COIN_TYPE]);
  });
});
