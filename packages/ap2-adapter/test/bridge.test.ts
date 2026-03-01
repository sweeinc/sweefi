import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transaction } from '@mysten/sui/transactions';

// Mock @sweefi/sui/ptb — bridge.ts delegates to these after validation + mapping
vi.mock('@sweefi/sui/ptb', () => ({
  buildCreateAgentMandateTx: vi.fn(() => 'mock-agent-mandate-tx' as unknown as Transaction),
  buildCreateInvoiceTx: vi.fn(() => 'mock-invoice-tx' as unknown as Transaction),
}));

import { buildAgentMandateFromIntent, buildInvoiceFromCart } from '../src/bridge';
import { buildCreateAgentMandateTx, buildCreateInvoiceTx } from '@sweefi/sui/ptb';
import type { SweefiConfig } from '@sweefi/sui/ptb';
import type { MandateDefaults, InvoiceDefaults } from '../src/types';

// ══════════════════════════════════════════════════════════════
// Test fixtures
// ══════════════════════════════════════════════════════════════

const VALID_SUI_ADDRESS = '0x' + 'a'.repeat(64);

const sweefiConfig: SweefiConfig = {
  packageId: '0x' + '1'.repeat(64),
};

const mandateDefaults: MandateDefaults = {
  coinType: '0x2::sui::SUI',
  delegator: VALID_SUI_ADDRESS,
  delegate: '0x' + 'b'.repeat(64),
  maxPerTx: '1000000000',
  dailyLimit: '5000000000',
  weeklyLimit: '20000000000',
  maxTotal: '100000000000',
  level: 2,
};

const invoiceDefaults: InvoiceDefaults = {
  coinType: '0x2::sui::SUI',
  payer: VALID_SUI_ADDRESS,
  payee: '0x' + 'c'.repeat(64),
  usdToBaseUnits: 1_000_000n,
  feeMicroPercent: 10_000,
  feeRecipient: '0x' + 'd'.repeat(64),
};

const validIntentJson = {
  user_cart_confirmation_required: true,
  natural_language_description: 'Buy noise-cancelling headphones under $200',
  merchants: ['Amazon'],
  skus: null,
  requires_refundability: true,
  intent_expiry: '2026-06-15T00:00:00Z',
};

const validCartJson = {
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
// buildAgentMandateFromIntent
// ══════════════════════════════════════════════════════════════

describe('buildAgentMandateFromIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates, maps, and delegates to buildCreateAgentMandateTx', () => {
    const tx = buildAgentMandateFromIntent(validIntentJson, mandateDefaults, sweefiConfig);

    expect(tx).toBe('mock-agent-mandate-tx');
    expect(buildCreateAgentMandateTx).toHaveBeenCalledOnce();
    expect(buildCreateAgentMandateTx).toHaveBeenCalledWith(
      sweefiConfig,
      expect.objectContaining({
        coinType: '0x2::sui::SUI',
        sender: VALID_SUI_ADDRESS,
        delegate: '0x' + 'b'.repeat(64),
        level: 2,
        expiresAtMs: BigInt(Date.parse('2026-06-15T00:00:00Z')),
      }),
    );
  });

  it('throws ZodError on invalid intent JSON', () => {
    const badJson = { not: 'an intent' };
    expect(() =>
      buildAgentMandateFromIntent(badJson, mandateDefaults, sweefiConfig),
    ).toThrow();
    expect(buildCreateAgentMandateTx).not.toHaveBeenCalled();
  });

  it('throws on invalid intent_expiry (Zod catches before mapper)', () => {
    const badExpiry = { ...validIntentJson, intent_expiry: 'garbage-date' };
    expect(() =>
      buildAgentMandateFromIntent(badExpiry, mandateDefaults, sweefiConfig),
    ).toThrow('Must be a valid ISO 8601 date string');
    expect(buildCreateAgentMandateTx).not.toHaveBeenCalled();
  });

  it('throws on missing required fields', () => {
    const missing = { intent_expiry: '2026-06-15T00:00:00Z' };
    expect(() =>
      buildAgentMandateFromIntent(missing, mandateDefaults, sweefiConfig),
    ).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// buildInvoiceFromCart
// ══════════════════════════════════════════════════════════════

describe('buildInvoiceFromCart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates, maps, and delegates to buildCreateInvoiceTx', () => {
    const tx = buildInvoiceFromCart(validCartJson, invoiceDefaults, sweefiConfig);

    expect(tx).toBe('mock-invoice-tx');
    expect(buildCreateInvoiceTx).toHaveBeenCalledOnce();
    expect(buildCreateInvoiceTx).toHaveBeenCalledWith(
      sweefiConfig,
      expect.objectContaining({
        sender: invoiceDefaults.payee,
        recipient: invoiceDefaults.payee,
        expectedAmount: 279_990_000n, // $279.99 × 1M
        feeMicroPercent: 10_000,
        sendTo: invoiceDefaults.payer,
      }),
    );
  });

  it('throws ZodError on invalid cart JSON', () => {
    const badJson = { contents: 'not valid' };
    expect(() =>
      buildInvoiceFromCart(badJson, invoiceDefaults, sweefiConfig),
    ).toThrow();
    expect(buildCreateInvoiceTx).not.toHaveBeenCalled();
  });

  it('throws on non-USD currency (mapper error)', () => {
    const euroCart = {
      ...validCartJson,
      contents: {
        ...validCartJson.contents,
        total: {
          label: 'Total',
          amount: { currency: 'EUR', value: 100 },
        },
      },
    };
    expect(() =>
      buildInvoiceFromCart(euroCart, invoiceDefaults, sweefiConfig),
    ).toThrow('Unsupported currency: EUR');
    expect(buildCreateInvoiceTx).not.toHaveBeenCalled();
  });

  it('throws on zero amount (mapper error)', () => {
    const zeroCart = {
      ...validCartJson,
      contents: {
        ...validCartJson.contents,
        total: {
          label: 'Total',
          amount: { currency: 'USD', value: 0 },
        },
      },
    };
    expect(() =>
      buildInvoiceFromCart(zeroCart, invoiceDefaults, sweefiConfig),
    ).toThrow('Cart total must be positive');
  });
});
