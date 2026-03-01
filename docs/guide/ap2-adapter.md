# @sweefi/ap2-adapter

Maps Google AP2 (Agent Payment Protocol) mandate types to SweeFi on-chain primitives. Three layers: types, mappers, and bridge.

## Install

```bash
pnpm add @sweefi/ap2-adapter @sweefi/sui
```

## What Is AP2?

[Google AP2](https://developers.google.com/payments/agent-payments) is an agent payment authorization standard. It defines how a human authorizes an AI agent to spend money — with limits, constraints, and revocation.

SweeFi and AP2 are complementary:

| Layer | AP2 | SweeFi |
|-------|-----|--------|
| **Authorization** | Mandates (intent + cart) | On-chain mandates (L0–L3) |
| **Settlement** | TBD (V1.x push payments) | Sui PTBs (live now) |
| **Enforcement** | Server-side | On-chain (Move consensus) |

AP2 defines the _what_ (authorization format). SweeFi provides the _how_ (on-chain enforcement + settlement).

## Architecture

```
AP2 Intent JSON ──→ Zod validation ──→ Mapper ──→ AgentMandateParams ──→ PTB Builder ──→ Transaction
```

Three layers:

1. **Types** — TypeScript types matching the AP2 spec
2. **Mappers** — Pure functions converting AP2 → SweeFi params
3. **Bridge** — Validate + map + build unsigned Sui transaction

## Quick Example

```typescript
import { buildAgentMandateFromIntent } from '@sweefi/ap2-adapter';
import { testnetConfig } from '@sweefi/sui/ptb';

// AP2 intent from the agent authorization flow
const intentJson = {
  user_cart_confirmation_required: false,
  natural_language_description: 'Purchase weather data up to $10/day',
  merchants: ['0xPROVIDER_ADDRESS'],
  intent_expiry: '2026-04-01T00:00:00Z',
};

// MandateDefaults — all 8 fields required (amounts as strings in MIST)
const defaults = {
  coinType: '0x2::sui::SUI',
  delegator: '0xHUMAN_ADDRESS_64HEX_CHARS_PADDED_TO_32_BYTES____',
  delegate: '0xAGENT_ADDRESS_64HEX_CHARS_PADDED_TO_32_BYTES____',
  maxPerTx: '1000000',       // 0.001 SUI
  dailyLimit: '10000000',    // 0.01 SUI
  weeklyLimit: '50000000',   // 0.05 SUI
  maxTotal: '500000000',     // 0.5 SUI
  level: 2,                  // L2: Capped (literal 0|1|2|3)
};

// Build an unsigned Sui transaction
const tx = buildAgentMandateFromIntent(intentJson, defaults, testnetConfig);

// Sign and execute
const result = await suiClient.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
});
```

**Key asymmetry**: AP2 provides only the `intent_expiry` to the mandate. All spending limits (maxPerTx, dailyLimit, weeklyLimit, maxTotal, level) come from the caller-provided defaults. This is intentional — AP2 authorizes intent, SweeFi enforces limits.

## Intent Mandate Schema

The AP2 intent mandate validates against this Zod schema:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_cart_confirmation_required` | boolean | Yes | If false, agent can purchase without confirmation |
| `natural_language_description` | string | Yes | NL description confirmed by user (min 1 char) |
| `merchants` | string[] \| null | No | Allowed merchants (null = any) |
| `skus` | string[] \| null | No | Specific product SKUs (null = any) |
| `requires_refundability` | boolean | No | If true, items must be refundable |
| `intent_expiry` | ISO 8601 string | Yes | Expiration timestamp |

## Mappers

Pure functions — no side effects, no blockchain calls.

### `createAgentMandateFromAP2Intent(intent, config)`

Maps an AP2 intent mandate to SweeFi's `AgentMandateParams`:

```typescript
import { createAgentMandateFromAP2Intent } from '@sweefi/ap2-adapter';

const params = createAgentMandateFromAP2Intent(validatedIntent, {
  coinType: '0x2::sui::SUI',
  delegator: '0xHUMAN_ADDRESS...',
  delegate: '0xAGENT_ADDRESS...',
  maxPerTx: '1000000',
  dailyLimit: '10000000',
  weeklyLimit: '50000000',
  maxTotal: '500000000',
  level: 2,
});
// → { coinType, sender, delegate, level, maxPerTx, dailyLimit, weeklyLimit, maxTotal, expiresAtMs }
```

`MandateDefaults` requires all 8 fields. Amount fields are **strings** (non-negative integer, in MIST). `level` is a literal union `0 | 1 | 2 | 3`.

### `createInvoiceFromAP2Cart(cart, defaults)`

Maps an AP2 cart mandate to a SweeFi invoice:

```typescript
import { createInvoiceFromAP2Cart } from '@sweefi/ap2-adapter';

const params = createInvoiceFromAP2Cart(cart, {
  coinType: '0x2::sui::SUI',
  payer: '0xPAYER_ADDRESS...',
  payee: '0xMERCHANT_ADDRESS...',
  usdToBaseUnits: 1_000_000n,   // USD → MIST conversion (e.g., 1 USD = 1M MIST)
  feeMicroPercent: 5000,         // 0.5%
  feeRecipient: '0xFEE_ADDR...',
});
// → { sender, recipient, expectedAmount, feeMicroPercent, feeRecipient, sendTo }
```

The cart structure follows the AP2 spec: `{ contents: { items, total, cart_expiry, merchant_name }, merchant_authorization? }`. The `total.amount` is converted to on-chain base units using `usdToBaseUnits`.

### Receipt Converters

```typescript
import {
  toAP2PaymentReceipt,
  toAP2PaymentReceiptError,
  toAP2PaymentMethodData,
} from '@sweefi/ap2-adapter';

// Convert SweeFi TX result → AP2 receipt
const receipt = toAP2PaymentReceipt('TxDigest123...');

// Advertise SweeFi capabilities in AP2 format
const methodData = toAP2PaymentMethodData();
// → {
//   supported_methods: ['s402'],
//   data: {
//     network: 'sui',
//     schemes: ['exact', 'stream', 'prepaid', 'escrow', 'unlock'],
//     transport: ['header', 'body'],
//   }
// }

// Override default schemes
const customMethodData = toAP2PaymentMethodData(['exact', 'prepaid']);
```

## Bridge Functions

Validate → map → build PTB in one call. Input is raw JSON (from HTTP request body).

### `buildAgentMandateFromIntent(json, defaults, config)`

```typescript
import { buildAgentMandateFromIntent } from '@sweefi/ap2-adapter';

const tx = buildAgentMandateFromIntent(
  rawJsonFromRequest,    // validated with Zod at runtime
  mandateDefaults,       // all 8 MandateDefaults fields
  sweefiConfig           // { packageId, protocolStateId }
);
// → unsigned Sui Transaction
// Throws ZodError if intent JSON fails validation
```

### `buildInvoiceFromCart(json, defaults, config)`

```typescript
import { buildInvoiceFromCart } from '@sweefi/ap2-adapter';

const tx = buildInvoiceFromCart(
  rawCartJson,
  invoiceDefaults,       // coinType, payer, payee, usdToBaseUnits, feeMicroPercent, feeRecipient
  sweefiConfig
);
```

## Zod Schemas

All input is validated at the trust boundary:

```typescript
import {
  intentMandateSchema,
  cartContentsSchema,
  cartMandateSchema,
  paymentMethodDataSchema,
  mandateDefaultsSchema,
  invoiceDefaultsSchema,
} from '@sweefi/ap2-adapter';
```

## Next Steps

- [Mandates](/guide/mandates) — On-chain mandate system (L0–L3)
- [@sweefi/sui](/guide/sui) — PTB builders for mandates
- [@sweefi/mcp](/guide/mcp) — Mandate tools for AI agents
