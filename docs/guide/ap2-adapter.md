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
  action: 'purchase',
  maxAmount: { value: '10.00', currency: 'USD' },
  merchant: { name: 'Weather API', id: '0xPROVIDER' },
  validUntil: '2026-04-01T00:00:00Z',
  constraints: {
    maxPerTransaction: '1.00',
    dailyLimit: '5.00',
  },
};

// Build an unsigned Sui transaction
const tx = buildAgentMandateFromIntent(
  intentJson,
  {
    coinType: '0x2::sui::SUI',
    delegate: '0xAGENT_ADDRESS',
    weeklyLimit: 25_000_000n,  // default for fields AP2 doesn't cover
  },
  testnetConfig
);

// Sign and execute
const result = await suiClient.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
});
```

## Mappers

Pure functions — no side effects, no blockchain calls.

### `createAgentMandateFromAP2Intent(intent, defaults)`

Maps an AP2 intent mandate to SweeFi's `AgentMandateParams`:

```typescript
import { createAgentMandateFromAP2Intent } from '@sweefi/ap2-adapter';

const params = createAgentMandateFromAP2Intent(
  validatedIntent,
  {
    coinType: '0x2::sui::SUI',
    delegate: '0xAGENT',
    weeklyLimit: 50_000_000n,
  }
);
// → { delegate, level, maxPerTx, dailyLimit, weeklyLimit, maxTotal, expiresAtMs, coinType }
```

### `createInvoiceFromAP2Cart(cart, defaults)`

Maps an AP2 cart mandate to a SweeFi invoice:

```typescript
import { createInvoiceFromAP2Cart } from '@sweefi/ap2-adapter';

const params = createInvoiceFromAP2Cart(cart, {
  coinType: '0x2::sui::SUI',
  feeMicroPercent: 5000,
  feeRecipient: '0xFEE_ADDR',
});
// → { recipient, amount, feeMicroPercent, feeRecipient }
```

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
// → { supportedMethods: ['sui-s402'], supportedSchemes: ['exact','prepaid','stream','escrow','seal'] }
```

## Bridge Functions

Validate → map → build PTB in one call. Input is raw JSON (from HTTP request body).

### `buildAgentMandateFromIntent(json, defaults, config)`

```typescript
import { buildAgentMandateFromIntent } from '@sweefi/ap2-adapter';

const tx = buildAgentMandateFromIntent(
  rawJsonFromRequest,    // validated with Zod
  mandateDefaults,       // coinType, delegate, weeklyLimit
  sweefiConfig           // { packageId, protocolStateId }
);
// → unsigned Sui Transaction
```

### `buildInvoiceFromCart(json, defaults, config)`

```typescript
import { buildInvoiceFromCart } from '@sweefi/ap2-adapter';

const tx = buildInvoiceFromCart(
  rawCartJson,
  invoiceDefaults,
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
