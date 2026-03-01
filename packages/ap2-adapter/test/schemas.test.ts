import { describe, it, expect } from 'vitest';
import {
  intentMandateSchema,
  cartContentsSchema,
  cartMandateSchema,
  paymentMethodDataSchema,
  mandateDefaultsSchema,
  invoiceDefaultsSchema,
} from '../src/schemas';

// ══════════════════════════════════════════════════════════════
// Test fixtures
// ══════════════════════════════════════════════════════════════

const VALID_SUI_ADDRESS = '0x' + 'a'.repeat(64);

const validIntentMandate = {
  user_cart_confirmation_required: true,
  natural_language_description: 'Buy me the cheapest noise-cancelling headphones under $200',
  merchants: ['Amazon', 'Best Buy'],
  skus: null,
  requires_refundability: true,
  intent_expiry: '2026-03-15T00:00:00Z',
};

const validCartContents = {
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
};

const validCartMandate = {
  contents: validCartContents,
  merchant_authorization: 'eyJhbGciOiJSUzI1NiJ9.mock-jwt',
};

const validPaymentMethodData = {
  supported_methods: ['s402'],
  data: { network: 'sui', schemes: ['exact', 'stream'] },
};

const validMandateDefaults = {
  coinType: '0x2::sui::SUI',
  delegator: VALID_SUI_ADDRESS,
  delegate: VALID_SUI_ADDRESS,
  maxPerTx: '1000000000',
  dailyLimit: '5000000000',
  weeklyLimit: '20000000000',
  maxTotal: '100000000000',
  level: 2 as const,
};

const validInvoiceDefaults = {
  coinType: '0x2::sui::SUI',
  payer: VALID_SUI_ADDRESS,
  payee: VALID_SUI_ADDRESS,
  usdToBaseUnits: 1_000_000n,
  feeMicroPercent: 10_000,
  feeRecipient: VALID_SUI_ADDRESS,
};

// ══════════════════════════════════════════════════════════════
// IntentMandate schema
// ══════════════════════════════════════════════════════════════

describe('intentMandateSchema', () => {
  it('accepts a valid IntentMandate', () => {
    const result = intentMandateSchema.safeParse(validIntentMandate);
    expect(result.success).toBe(true);
  });

  it('accepts minimal IntentMandate (optional fields omitted)', () => {
    const result = intentMandateSchema.safeParse({
      user_cart_confirmation_required: true,
      natural_language_description: 'Buy headphones',
      intent_expiry: '2026-12-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty natural_language_description', () => {
    const result = intentMandateSchema.safeParse({
      ...validIntentMandate,
      natural_language_description: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid intent_expiry', () => {
    const result = intentMandateSchema.safeParse({
      ...validIntentMandate,
      intent_expiry: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing user_cart_confirmation_required', () => {
    const { user_cart_confirmation_required: _, ...without } = validIntentMandate;
    const result = intentMandateSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// CartContents / CartMandate schemas
// ══════════════════════════════════════════════════════════════

describe('cartContentsSchema', () => {
  it('accepts valid cart contents', () => {
    const result = cartContentsSchema.safeParse(validCartContents);
    expect(result.success).toBe(true);
  });

  it('rejects empty items array', () => {
    const result = cartContentsSchema.safeParse({
      ...validCartContents,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing merchant_name', () => {
    const { merchant_name: _, ...without } = validCartContents;
    const result = cartContentsSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects currency code too short', () => {
    const result = cartContentsSchema.safeParse({
      ...validCartContents,
      total: {
        label: 'Total',
        amount: { currency: 'US', value: 100 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('cartMandateSchema', () => {
  it('accepts valid cart mandate with JWT', () => {
    const result = cartMandateSchema.safeParse(validCartMandate);
    expect(result.success).toBe(true);
  });

  it('accepts cart mandate without merchant_authorization', () => {
    const result = cartMandateSchema.safeParse({
      contents: validCartContents,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null merchant_authorization', () => {
    const result = cartMandateSchema.safeParse({
      contents: validCartContents,
      merchant_authorization: null,
    });
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// PaymentMethodData schema
// ══════════════════════════════════════════════════════════════

describe('paymentMethodDataSchema', () => {
  it('accepts valid payment method data', () => {
    const result = paymentMethodDataSchema.safeParse(validPaymentMethodData);
    expect(result.success).toBe(true);
  });

  it('rejects empty supported_methods', () => {
    const result = paymentMethodDataSchema.safeParse({
      supported_methods: [],
    });
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// Config schemas (SweeFi-side)
// ══════════════════════════════════════════════════════════════

describe('mandateDefaultsSchema', () => {
  it('accepts valid mandate defaults', () => {
    const result = mandateDefaultsSchema.safeParse(validMandateDefaults);
    expect(result.success).toBe(true);
  });

  it('rejects invalid Sui address (too short)', () => {
    const result = mandateDefaultsSchema.safeParse({
      ...validMandateDefaults,
      delegator: '0xabc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid MIST amount (negative)', () => {
    const result = mandateDefaultsSchema.safeParse({
      ...validMandateDefaults,
      maxPerTx: '-100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid MIST amount (decimal)', () => {
    const result = mandateDefaultsSchema.safeParse({
      ...validMandateDefaults,
      maxPerTx: '100.5',
    });
    expect(result.success).toBe(false);
  });

  it('rejects level outside 0-3', () => {
    const result = mandateDefaultsSchema.safeParse({
      ...validMandateDefaults,
      level: 5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid levels (0-3)', () => {
    for (const level of [0, 1, 2, 3]) {
      const result = mandateDefaultsSchema.safeParse({
        ...validMandateDefaults,
        level,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('invoiceDefaultsSchema', () => {
  it('accepts valid invoice defaults', () => {
    const result = invoiceDefaultsSchema.safeParse(validInvoiceDefaults);
    expect(result.success).toBe(true);
  });

  it('rejects feeMicroPercent > 1000000', () => {
    const result = invoiceDefaultsSchema.safeParse({
      ...validInvoiceDefaults,
      feeMicroPercent: 1_000_001,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative feeMicroPercent', () => {
    const result = invoiceDefaultsSchema.safeParse({
      ...validInvoiceDefaults,
      feeMicroPercent: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive usdToBaseUnits', () => {
    const result = invoiceDefaultsSchema.safeParse({
      ...validInvoiceDefaults,
      usdToBaseUnits: 0n,
    });
    expect(result.success).toBe(false);
  });
});
