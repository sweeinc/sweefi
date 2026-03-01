# @sweefi/server

Chain-agnostic HTTP middleware for s402 payments. Two exports: `s402Gate` for servers and `wrapFetchWithS402` for clients.

## Install

```bash
pnpm add @sweefi/server
```

No blockchain dependencies — `@sweefi/server` only handles HTTP. Bring `@sweefi/sui` or `@sweefi/solana` for chain-specific settlement.

## Subpath Exports

| Import | What It Provides |
|--------|-----------------|
| `@sweefi/server` | Everything (server + client) |
| `@sweefi/server/server` | `s402Gate` only |
| `@sweefi/server/client` | `wrapFetchWithS402` only |

## Server: `s402Gate`

Hono middleware that gates routes behind s402 payments.

```typescript
import { Hono } from 'hono';
import { s402Gate } from '@sweefi/server';

const app = new Hono();

app.use('/premium', s402Gate({
  price: '1000000',
  network: 'sui:testnet',
  payTo: '0xYOUR_ADDRESS',
  schemes: ['exact'],
}));

app.get('/premium', (c) => c.json({ data: 'premium content' }));
```

### Configuration

```typescript
interface s402GateConfig {
  price: string;           // Amount in smallest unit (MIST for SUI)
  network: string;         // CAIP-2 network (e.g., 'sui:testnet')
  payTo: string;           // Recipient address
  asset?: string;          // Coin type (default: SUI)
  schemes?: string[];      // Accepted schemes (default: ['exact'])
  facilitatorUrl?: string; // Settlement service URL
  processPayment?: (payment: unknown) => Promise<unknown>; // Custom handler
}
```

### Behavior

| Scenario | Response |
|----------|----------|
| No payment header | 402 + requirements JSON |
| Valid payment | Calls `next()` |
| Invalid payment | 402 + error |
| Facilitator error | 502 |

## Client: `wrapFetchWithS402`

Wraps any `fetch` function to auto-handle 402 responses.

```typescript
import { wrapFetchWithS402 } from '@sweefi/server';
import { SuiPaymentAdapter } from '@sweefi/sui';

const adapter = new SuiPaymentAdapter({ /* ... */ });

const response = await wrapFetchWithS402(
  fetch,
  adapter,
  { facilitatorUrl: 'https://facilitator.example.com' }
);

const data = await response('https://api.example.com/premium');
```

The wrapper:
1. Sends the initial `GET`
2. If 402, extracts requirements from the response
3. Calls `adapter.signAndBroadcast(requirements)` to build + sign a payment
4. Retries the request with the payment in the `X-PAYMENT` header
5. Returns the final response

### Options

```typescript
interface s402FetchOptions {
  facilitatorUrl?: string;  // Settlement service URL
  maxRetries?: number;      // Max retry attempts
}
```

## Error Handling

```typescript
import { s402PaymentSentError } from '@sweefi/server';

try {
  const res = await wrappedFetch('https://api.example.com/premium');
} catch (err) {
  if (err instanceof s402PaymentSentError) {
    // Payment was sent but server still rejected
    console.log('Payment TX:', err.txId);
  }
}
```

## Next Steps

- [Quick Start — Server](/guide/quickstart-server) — End-to-end server setup
- [Self-Hosting Facilitator](/guide/facilitator) — Deploy your own settlement service
- [@sweefi/sui](/guide/sui) — Sui-specific adapter
- [@sweefi/solana](/guide/solana) — Solana-specific adapter
