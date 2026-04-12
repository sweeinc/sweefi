# @sweefi/ap2-adapter

AP2 (Agent Payments Protocol) adapter for SweeFi — maps Google's AP2 mandate types to SweeFi on-chain primitives on Sui.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## What this does

AP2 defines *what* an agent is authorized to buy. SweeFi enforces *how* it pays on-chain. This adapter bridges the two:

| AP2 Input | SweeFi Output | Mapping Strength |
|-----------|---------------|-----------------|
| IntentMandate (6 fields) | AgentMandate (9 fields) | **Thin** — only TTL maps, caller supplies 8 fields |
| CartMandate (amount, merchant, expiry) | Invoice (amount, payer, payee) | **Strong** — structural mapping |
| — | PaymentReceipt | Outbound: Sui tx digest → AP2 receipt |
| — | PaymentMethodData | Discovery: advertise s402 schemes to AP2 agents |

---

## Install

```bash
npm install @sweefi/ap2-adapter
```

Peer dependencies:
- `@mysten/sui` (>=2.0.0) — for Transaction types in the bridge layer

---

## Three layers — use what you need

### 1. Types only (zero runtime)

```typescript
import type { AP2IntentMandate, AP2CartMandate, MandateDefaults } from '@sweefi/ap2-adapter';
```

### 2. Pure mappers (lightweight — only depends on zod)

```typescript
import {
  createAgentMandateFromAP2Intent,
  createInvoiceFromAP2Cart,
  toAP2PaymentReceipt,
  toAP2PaymentMethodData,
} from '@sweefi/ap2-adapter';

// IntentMandate → AgentMandate params (caller provides spending limits)
const mandateParams = createAgentMandateFromAP2Intent(ap2Intent, {
  coinType: '0x2::sui::SUI',
  delegator: '0xHUMAN...',
  delegate: '0xAGENT...',
  maxPerTx: '1000000000',     // 1 SUI
  dailyLimit: '5000000000',   // 5 SUI
  weeklyLimit: '20000000000', // 20 SUI
  maxTotal: '100000000000',   // 100 SUI
  level: 2,                   // CAPPED
});

// CartMandate → Invoice params (strong structural mapping)
const invoiceParams = createInvoiceFromAP2Cart(ap2Cart, {
  coinType: '0x2::sui::SUI',
  payer: '0xBUYER...',
  payee: '0xMERCHANT...',
  usdToBaseUnits: 1_000_000n, // 1 USD = 1M base units (USDC-6)
  feeMicroPercent: 10_000,             // 1% facilitator fee
  feeRecipient: '0xFEE...',
});

// Outbound: Sui tx digest → AP2 receipt
const receipt = toAP2PaymentReceipt('ABC123...');

// Discovery: advertise s402 to AP2 agents
const methodData = toAP2PaymentMethodData(); // all 5 schemes
```

### 3. Bridge — end-to-end (validate → map → build PTB)

```typescript
import { buildAgentMandateFromIntent, buildInvoiceFromCart } from '@sweefi/ap2-adapter';
import { testnetConfig } from '@sweefi/sui/ptb';

// Raw AP2 JSON in → unsigned Sui Transaction out
const tx = buildAgentMandateFromIntent(
  rawIntentJson,    // validated at runtime via Zod
  mandateDefaults,  // your spending config
  testnetConfig,    // deployed SweeFi contracts
);

// Sign and execute
const result = await client.signAndExecuteTransaction({ transaction: tx });
```

---

## Zod schemas (trust boundary validation)

All AP2 data is validated at the trust boundary before mapping:

```typescript
import {
  intentMandateSchema,
  cartMandateSchema,
  mandateDefaultsSchema,
  invoiceDefaultsSchema,
} from '@sweefi/ap2-adapter';

// Validate raw AP2 JSON
const intent = intentMandateSchema.parse(untrustedJson);
```

---

## Why the mapping is asymmetric

**AP2 IntentMandate** is pure authorization intent — "buy headphones under $200." It has zero financial fields. SweeFi AgentMandate is an on-chain enforcement boundary with per-tx caps, daily/weekly limits, and tiered autonomy levels (L0-L3). The adapter is a thin factory where the caller provides 8 of 9 fields.

**AP2 CartMandate** carries real financial data — amount, currency, merchant, expiry. This maps structurally to a SweeFi Invoice. The adapter converts USD → on-chain base units using the caller's exchange rate.

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Sui client + $extend() plugin + contract classes |
| [`@sweefi/hono`](https://www.npmjs.com/package/@sweefi/hono) | Chain-agnostic HTTP middleware + fetch wrapper |
| [`@sweefi/mcp`](https://www.npmjs.com/package/@sweefi/mcp) | 35 AI payment tools for Claude, Cursor, any MCP client |
| [`s402`](https://www.npmjs.com/package/s402) | Protocol types + HTTP codec (dual transport: headers + JSON body) |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
