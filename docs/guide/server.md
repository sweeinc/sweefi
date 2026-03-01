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
  price: string;                // Amount in smallest unit (MIST for SUI)
  network: string;              // CAIP-2 network (e.g., 'sui:testnet')
  payTo: string;                // Recipient address
  asset?: string;               // Coin type (default: SUI)
  schemes?: s402Scheme[];       // Accepted schemes (default: ['exact'])
  facilitatorUrl?: string;      // Settlement service URL
  processPayment?: (            // Custom handler
    payload: unknown,
    requirements: s402PaymentRequirements,
  ) => Promise<s402SettleResponse>;
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
import { createS402Client } from '@sweefi/sui';

const client = createS402Client({ wallet: keypair, network: 'sui:testnet' });

// wrapFetchWithS402 returns a new fetch function (synchronous)
const paidFetch = wrapFetchWithS402(fetch, client, {
  facilitatorUrl: 'https://facilitator.example.com',
});

const data = await paidFetch('https://api.example.com/premium');
```

The wrapper:
1. Sends the initial `GET`
2. If 402, extracts requirements from the `payment-required` header
3. Calls the s402 client to build + sign a payment
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
  const res = await paidFetch('https://api.example.com/premium');
} catch (err) {
  if (err instanceof s402PaymentSentError) {
    // Payment was sent but response was lost (network error)
    // Check on-chain state before retrying:
    console.log('Code:', err.code);           // 'PAYMENT_SENT_RESPONSE_LOST'
    console.log('Amount:', err.requirements.amount);
    console.log('PayTo:', err.requirements.payTo);
  }
}
```

## Next Steps

- [Quick Start — Server](/guide/quickstart-server) — End-to-end server setup
- [Self-Hosting Facilitator](/guide/facilitator) — Deploy your own settlement service
- [@sweefi/sui](/guide/sui) — Sui-specific adapter
- [@sweefi/solana](/guide/solana) — Solana-specific adapter
