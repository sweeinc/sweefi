# @sweefi/hono

Chain-agnostic s402 HTTP middleware and fetch wrapper.

`@sweefi/hono` implements the [s402 protocol](https://github.com/sweeinc/sweefi) at the HTTP layer — **without any blockchain dependency**. It works with any chain adapter (Sui, Solana, etc.) via the `PaymentAdapter` interface.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## Two usage paths

| Who you are | What you need | Import |
|---|---|---|
| Running an API that should charge per call | Gate routes with 402 | `@sweefi/hono` or `@sweefi/hono/server` |
| Building an AI agent or client app | Wrap fetch to auto-pay 402s | `@sweefi/hono/client` |

> **Note:** For a complete Sui client with wallet signing, use [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) which builds on this package and adds `createS402Client` and `adaptWallet`.

---

## Install

```bash
npm install @sweefi/hono
# For server-side gating with Hono:
npm install hono
```

---

## Server — charging for your API

`s402Gate` is Hono middleware that turns any route into a paid endpoint. Unpaid requests get a `402 Payment Required` response with machine-readable payment instructions. Paid requests are verified and passed through.

```typescript
import { Hono } from 'hono';
import { s402Gate } from '@sweefi/hono';

const app = new Hono();

app.use(
  '/api/data',
  s402Gate({
    price: '1000000',        // 0.001 SUI (in base units; 1 SUI = 1_000_000_000)
    network: 'sui:testnet',
    payTo: '0xYOUR_ADDRESS',
  })
);

app.get('/api/data', (c) => c.json({ result: 'premium data' }));

export default app;
```

### Server configuration

```typescript
s402Gate({
  // Required
  price: '1000000',         // payment amount in base units
  network: 'sui:testnet',   // 'sui:testnet' | 'sui:mainnet' | 'sui:devnet'
  payTo: '0xYOUR_ADDRESS',  // your Sui address

  // Optional
  asset: '0x2::sui::SUI',   // default: SUI. Swap in a USDC coin type for stablecoin billing
  schemes: ['exact'],        // accepted payment schemes (always includes 'exact')
  facilitatorUrl: 'https://your-facilitator.example.com',
  protocolFeeBps: 50,        // protocol fee in basis points

  // Require a spending mandate (optional)
  mandate: {
    required: true,
    minPerTx: '500000',
  },

  // Prepaid deposit-and-draw billing (optional — requires 'prepaid' in schemes)
  prepaid: {
    ratePerCall: '1000000',
    minDeposit: '10000000',
    withdrawalDelayMs: '86400000',
    maxCalls: '1000',
  },

  // Custom verify+settle handler (optional — overrides built-in facilitator call)
  processPayment: async (payload, requirements) => {
    // verify and settle yourself; must return an s402SettleResponse
    return { success: true, txDigest: '0xABC...' };
  },
})
```

### Reading the receipt downstream

After a successful payment, `s402Gate` stores the settlement receipt on the Hono context. Access it in your route handler:

```typescript
app.get('/api/data', (c) => {
  const receipt = c.get('s402Receipt'); // s402SettleResponse
  return c.json({ result: 'premium data', paidAt: receipt?.txDigest });
});
```

---

## Client — wrapping an existing fetch

`wrapFetchWithS402` upgrades any fetch function with automatic 402 handling. This is the chain-agnostic layer — it detects 402 responses and delegates to a `PaymentAdapter` to build and sign the payment.

```typescript
import { wrapFetchWithS402 } from '@sweefi/hono/client';

const paidFetch = wrapFetchWithS402(globalThis.fetch, s402Client, {
  facilitatorUrl: 'https://your-facilitator.example.com',
  maxRetries: 1, // default
});

const response = await paidFetch('https://api.example.com/premium/data');
```

> For a complete one-call setup with a Sui wallet, use `createS402Client` from `@sweefi/sui` instead — it combines `wrapFetchWithS402` with a `SuiPaymentAdapter` for you.

---

## How the s402 flow works

```
1. Agent sends request
   GET /api/data

2. Server responds 402
   HTTP 402 Payment Required
   X-PAYMENT-REQUIRED: <base64-encoded requirements>
   { "error": "Payment Required", "s402Version": "1" }

3. Client pays
   wrapFetchWithS402 reads the requirements, invokes the PaymentAdapter
   to sign and broadcast the transaction, then retries:
   GET /api/data
   X-PAYMENT: <base64-encoded payment payload>

4. Server verifies and grants access
   s402Gate decodes the header, verifies via the facilitator,
   stores the receipt on context, calls next()
   → 200 OK with your actual response
```

---

## Accepted payment schemes

| Scheme | When to use | Requires `packageId` |
|---|---|---|
| `exact` | Simple per-call payments. Always included. | No |
| `prepaid` | Deposit-and-draw billing for high-volume callers | Yes |
| `stream` | Rate-limited micropayment streams | Yes |
| `escrow` | Time-locked payments with arbiter | Yes |
| `unlock` | SEAL-based content unlocks | Yes |

---

## Subpath imports

The package ships three entry points so you only bundle what you use:

```typescript
// Root — server middleware + client fetch wrapper (no blockchain deps)
import { s402Gate, wrapFetchWithS402 } from '@sweefi/hono';

// Client only — fetch wrapper (browser / agent / edge safe, no blockchain deps)
import { wrapFetchWithS402 } from '@sweefi/hono/client';
import type { s402FetchOptions } from '@sweefi/hono/client';

// Server only — Hono middleware (Node.js and edge runtimes)
import { s402Gate } from '@sweefi/hono/server';
import type { s402GateConfig } from '@sweefi/hono/server';

// Wallet adapting is in @sweefi/sui (not here — keeps this package chain-agnostic)
import { adaptWallet } from '@sweefi/sui';
```

---

## Peer dependencies

| Package | Required | Notes |
|---|---|---|
| `hono` | No (server only) | `>=4.0.0`. Only needed if you use `s402Gate`. |

This package has **no blockchain peer dependencies** — chain-specific logic lives in `@sweefi/sui` (or future chain adapters).

---

## Ecosystem

| Package | Purpose |
|---|---|
| [`@sweefi/hono`](https://www.npmjs.com/package/@sweefi/hono) | This package — chain-agnostic HTTP middleware + fetch wrapper |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Full Sui client: `createS402Client`, $extend() plugin + contract classes, `SuiPaymentAdapter` |
| [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core) | Framework-agnostic payment state machine + `PaymentAdapter` interface |
| [`@sweefi/mcp`](https://www.npmjs.com/package/@sweefi/mcp) | 35 payment tools for Claude, Cursor, and any MCP-compatible AI (30 default + 5 opt-in) |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
