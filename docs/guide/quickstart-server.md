# Quick Start — Server (Provider)

Gate API endpoints behind s402 payments using `@sweefi/server`.

## Install

```bash
pnpm add @sweefi/server hono
```

## Protect an Endpoint

```typescript
import { Hono } from 'hono';
import { s402Gate } from '@sweefi/server';

const app = new Hono();

// Free endpoint — no payment required
app.get('/api/weather', (c) => c.json({ temp: 72, unit: 'F' }));

// Premium endpoint — requires 0.001 SUI per request
app.use('/api/forecast', s402Gate({
  price: '1000000',          // 1,000,000 MIST = 0.001 SUI
  network: 'sui:testnet',
  payTo: '0xYOUR_SUI_ADDRESS',
  schemes: ['exact'],        // Also: 'prepaid', 'stream', 'escrow', 'unlock'
}));

app.get('/api/forecast', (c) => c.json({
  forecast: '7-day detailed forecast',
  confidence: 0.94,
}));

export default app;
```

::: warning Payment Settlement Required
The examples above advertise payment requirements but don't settle payments on the server. To accept payments, you need a **`processPayment`** handler — a function that verifies and settles the payment proof.

Without `processPayment`, `s402Gate` returns 402 "Payment settlement not configured" on every payment attempt. This is secure by default — payments fail closed.

The `facilitatorUrl` option is **metadata** — it's included in the 402 response so the *client* knows where to submit payments, but the server middleware itself does not call it. The [facilitator](/guide/facilitator) settles payments on behalf of the client, not the server.
:::

## What `s402Gate` Does

1. If no payment header → responds with **402** and requirements JSON
2. If `x-payment` header present → validates the payment proof
3. If `processPayment` configured → settles the payment
4. If valid → calls `next()` and your handler runs
5. If invalid or no `processPayment` configured → responds with **402** and error details

The 402 response includes a `payment-required` header containing base64-encoded JSON with everything the client needs to pay:

```json
{
  "s402Version": "1",
  "accepts": ["exact"],
  "amount": "1000000",
  "asset": "0x2::sui::SUI",
  "network": "sui:testnet",
  "payTo": "0xYOUR_SUI_ADDRESS"
}
```

## Multiple Schemes

Accept prepaid budgets alongside exact payments:

```typescript
app.use('/api/premium', s402Gate({
  price: '1000000',
  network: 'sui:testnet',
  payTo: '0xYOUR_SUI_ADDRESS',
  schemes: ['exact', 'prepaid'],
}));
```

With prepaid, an agent deposits once and calls your API hundreds of times off-chain — ~70x gas savings versus per-call exact payments.

## With a Facilitator (Production)

For production, add a [facilitator](/guide/facilitator) to verify and settle payments. This is the simplest path to accepting real payments:

```typescript
app.use('/api/premium', s402Gate({
  price: '1000000',
  network: 'sui:testnet',
  payTo: '0xYOUR_SUI_ADDRESS',
  schemes: ['exact'],
  facilitatorUrl: 'https://your-facilitator.fly.dev',
}));
```

The facilitator verifies the signed transaction, broadcasts it to Sui, and returns the settlement proof to your middleware.

## Next Steps

- [Quick Start — Agent](/guide/quickstart-agent) — Build the client side
- [Self-Hosting Facilitator](/guide/facilitator) — Deploy your own settlement service
- [@sweefi/server Reference](/guide/server) — Full middleware API
- [Payment Schemes](/guide/exact) — Choose the right scheme for your use case
