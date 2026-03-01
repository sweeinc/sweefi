import { describe, it, expect } from 'vitest';
import {
  createAgentMandateFromAP2Intent,
  createInvoiceFromAP2Cart,
  toAP2PaymentReceipt,
  toAP2PaymentReceiptError,
  toAP2PaymentMethodData,
} from '../src/mapper';
import type {
  AP2IntentMandate,
  AP2CartMandate,
  MandateDefaults,
  InvoiceDefaults,
} from '../src/types';

// ══════════════════════════════════════════════════════════════
// Test fixtures
// ══════════════════════════════════════════════════════════════

const VALID_SUI_ADDRESS = '0x' + 'a'.repeat(64);

const mandateDefaults: MandateDefaults = {
  coinType: '0x2::sui::SUI',
  delegator: VALID_SUI_ADDRESS,
  delegate: '0x' + 'b'.repeat(64),
  maxPerTx: '1000000000',    // 1 SUI
  dailyLimit: '5000000000',  // 5 SUI
  weeklyLimit: '20000000000', // 20 SUI
  maxTotal: '100000000000',   // 100 SUI
  level: 2, // CAPPED
};

const invoiceDefaults: InvoiceDefaults = {
  coinType: '0x2::sui::SUI',
  payer: VALID_SUI_ADDRESS,
  payee: '0x' + 'c'.repeat(64),
  usdToBaseUnits: 1_000_000n, // 1 USD = 1M base units (USDC-6 style)
  feeMicroPercent: 10_000,     // 1%
  feeRecipient: '0x' + 'd'.repeat(64),
};

const sampleIntent: AP2IntentMandate = {
  user_cart_confirmation_required: true,
  natural_language_description: 'Buy me noise-cancelling headphones under $200',
  merchants: ['Amazon'],
  skus: null,
  requires_refundability: true,
  intent_expiry: '2026-06-15T00:00:00Z',
};

const sampleCart: AP2CartMandate = {
  contents: {
    items: [
      {
        label: 'Sony WH-1000XM5',
        amount: { currency: 'USD', value: 279.99 },
        pending: false,
      },
    ],
    total: {
      label: 'Total',
      amount: { currency: 'USD', value: 279.99 },
    },
    cart_expiry: '2026-03-01T12:00:00Z',
    merchant_name: 'Amazon',
  },
  merchant_authorization: 'eyJhbGciOiJSUzI1NiJ9.mock',
};

// ══════════════════════════════════════════════════════════════
// IntentMandate → AgentMandate
// ══════════════════════════════════════════════════════════════

describe('createAgentMandateFromAP2Intent', () => {
  it('maps intent_expiry to expiresAtMs', () => {
    const result = createAgentMandateFromAP2Intent(sampleIntent, mandateDefaults);
    const expectedMs = BigInt(Date.parse('2026-06-15T00:00:00Z'));
    expect(result.expiresAtMs).toBe(expectedMs);
  });

  it('passes through all MandateDefaults fields', () => {
    const result = createAgentMandateFromAP2Intent(sampleIntent, mandateDefaults);

    expect(result.coinType).toBe(mandateDefaults.coinType);
    expect(result.sender).toBe(mandateDefaults.delegator);
    expect(result.delegate).toBe(mandateDefaults.delegate);
    expect(result.level).toBe(mandateDefaults.level);
    expect(result.maxPerTx).toBe(BigInt(mandateDefaults.maxPerTx));
    expect(result.dailyLimit).toBe(BigInt(mandateDefaults.dailyLimit));
    expect(result.weeklyLimit).toBe(BigInt(mandateDefaults.weeklyLimit));
    expect(result.maxTotal).toBe(BigInt(mandateDefaults.maxTotal));
  });

  it('converts MIST string amounts to bigint', () => {
    const result = createAgentMandateFromAP2Intent(sampleIntent, mandateDefaults);
    expect(typeof result.maxPerTx).toBe('bigint');
    expect(typeof result.dailyLimit).toBe('bigint');
    expect(typeof result.weeklyLimit).toBe('bigint');
    expect(typeof result.maxTotal).toBe('bigint');
    expect(typeof result.expiresAtMs).toBe('bigint');
  });

  it('throws on invalid intent_expiry', () => {
    const badIntent = { ...sampleIntent, intent_expiry: 'garbage' };
    expect(() =>
      createAgentMandateFromAP2Intent(badIntent, mandateDefaults),
    ).toThrow('Invalid intent_expiry');
  });

  it('handles various ISO 8601 date formats', () => {
    const dates = [
      '2026-12-31T23:59:59Z',
      '2026-01-01T00:00:00.000Z',
      '2026-06-15T12:30:00+05:30',
    ];
    for (const date of dates) {
      const intent = { ...sampleIntent, intent_expiry: date };
      const result = createAgentMandateFromAP2Intent(intent, mandateDefaults);
      expect(result.expiresAtMs).toBe(BigInt(Date.parse(date)));
    }
  });
});

// ══════════════════════════════════════════════════════════════
// CartMandate → Invoice
// ══════════════════════════════════════════════════════════════

describe('createInvoiceFromAP2Cart', () => {
  it('converts USD amount to base units', () => {
    const result = createInvoiceFromAP2Cart(sampleCart, invoiceDefaults);
    // $279.99 × 1_000_000 = 279_990_000
    expect(result.expectedAmount).toBe(279_990_000n);
  });

  it('maps payee as both sender and recipient', () => {
    const result = createInvoiceFromAP2Cart(sampleCart, invoiceDefaults);
    // Payee creates the invoice (sender) and receives payment (recipient)
    expect(result.sender).toBe(invoiceDefaults.payee);
    expect(result.recipient).toBe(invoiceDefaults.payee);
  });

  it('sends invoice to payer', () => {
    const result = createInvoiceFromAP2Cart(sampleCart, invoiceDefaults);
    expect(result.sendTo).toBe(invoiceDefaults.payer);
  });

  it('passes through fee config', () => {
    const result = createInvoiceFromAP2Cart(sampleCart, invoiceDefaults);
    expect(result.feeMicroPercent).toBe(invoiceDefaults.feeMicroPercent);
    expect(result.feeRecipient).toBe(invoiceDefaults.feeRecipient);
  });

  it('handles exact dollar amounts (no cents)', () => {
    const cart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: 10 },
        },
      },
    };
    const result = createInvoiceFromAP2Cart(cart, invoiceDefaults);
    // $10 × 1_000_000 = 10_000_000
    expect(result.expectedAmount).toBe(10_000_000n);
  });

  it('handles sub-cent amounts correctly', () => {
    const cart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: 0.001 },
        },
      },
    };
    const result = createInvoiceFromAP2Cart(cart, invoiceDefaults);
    // $0.001 × 1_000_000 = 1000
    expect(result.expectedAmount).toBe(1000n);
  });

  it('throws on non-USD currency', () => {
    const euroCart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'EUR', value: 100 },
        },
      },
    };
    expect(() => createInvoiceFromAP2Cart(euroCart, invoiceDefaults)).toThrow(
      'Unsupported currency: EUR',
    );
  });

  it('throws on zero amount', () => {
    const zeroCart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: 0 },
        },
      },
    };
    expect(() => createInvoiceFromAP2Cart(zeroCart, invoiceDefaults)).toThrow(
      'Cart total must be positive',
    );
  });

  it('throws on negative amount', () => {
    const negCart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: -50 },
        },
      },
    };
    expect(() => createInvoiceFromAP2Cart(negCart, invoiceDefaults)).toThrow(
      'Cart total must be positive',
    );
  });

  it('handles large amounts without overflow', () => {
    const bigCart: AP2CartMandate = {
      contents: {
        ...sampleCart.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: 1_000_000 }, // $1M
        },
      },
    };
    const result = createInvoiceFromAP2Cart(bigCart, invoiceDefaults);
    // $1M × 1_000_000 = 1_000_000_000_000 (1 trillion base units)
    expect(result.expectedAmount).toBe(1_000_000_000_000n);
  });
});

// ══════════════════════════════════════════════════════════════
// Outbound: Sui → AP2
// ══════════════════════════════════════════════════════════════

describe('toAP2PaymentReceipt', () => {
  const digest = 'ABC123def456GHI789jkl012MNO345pqr678STU901vwx234';

  it('creates a success receipt from tx digest', () => {
    const receipt = toAP2PaymentReceipt(digest);
    expect(receipt.status).toBe('success');
    expect(receipt.receipt_id).toBe(digest);
    expect(receipt.success?.merchant_confirmation_id).toBe(digest);
    expect(receipt.success?.network_confirmation_id).toBe(digest);
  });

  it('includes ISO 8601 timestamp', () => {
    const receipt = toAP2PaymentReceipt(digest);
    expect(() => new Date(receipt.timestamp)).not.toThrow();
    expect(new Date(receipt.timestamp).toISOString()).toBe(receipt.timestamp);
  });
});

describe('toAP2PaymentReceiptError', () => {
  it('creates an error receipt', () => {
    const receipt = toAP2PaymentReceiptError('Insufficient gas');
    expect(receipt.status).toBe('error');
    expect(receipt.error?.error_message).toBe('Insufficient gas');
    expect(receipt.receipt_id).toMatch(/^error-/);
  });
});

describe('toAP2PaymentMethodData', () => {
  it('advertises s402 with all 5 schemes by default', () => {
    const data = toAP2PaymentMethodData();
    expect(data.supported_methods).toEqual(['s402']);
    expect(data.data).toMatchObject({
      network: 'sui',
      schemes: ['exact', 'stream', 'prepaid', 'escrow', 'unlock'],
      transport: ['header', 'body'],
    });
  });

  it('accepts custom scheme list', () => {
    const data = toAP2PaymentMethodData(['exact', 'prepaid']);
    expect((data.data as any).schemes).toEqual(['exact', 'prepaid']);
  });
});
