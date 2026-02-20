# @sweefi/sdk

Add payments to any app in 3 lines of code.

`@sweefi/sdk` implements the [s402 protocol](https://github.com/sweeinc/sweefi) on Sui — the open standard for machine-to-machine payments over HTTP. Drop it into an AI agent to pay any s402-gated API automatically, or add it to your server to start charging for your API endpoints.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## Two usage paths

| Who you are | What you need | Import |
|---|---|---|
| Building an AI agent or client app | Auto-pay APIs that return 402 | `@sweefi/sdk/client` |
| Running an API that should charge per call | Gate routes behind payments | `@sweefi/sdk/server` |

Both paths are also available from the root import (`@sweefi/sdk`).

---

## Install

```bash
npm install @sweefi/sdk @mysten/sui
# For server-side gating with Hono:
npm install hono
```

---

## Client — AI agent paying for APIs

Give your agent a wallet. Every request to a paid API is handled transparently: the fetch call goes out, the server responds with 402, your agent pays, and the request is retried with a payment header — all in one `await`.

```typescript
import { createS402Client } from '@sweefi/sdk/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const wallet = Ed25519Keypair.generate(); // or load from env
const client = createS402Client({ wallet, network: 'sui:testnet' });

const response = await client.fetch('https://api.example.com/premium/data');
const data = await response.json();
```

That's it. `client.fetch` is a drop-in replacement for the global `fetch`. Unpaid APIs pass through unchanged. Paid APIs are handled automatically.

### Client configuration

```typescript
const client = createS402Client({
  // Required
  wallet: Ed25519Keypair.generate(),  // any @mysten/sui Signer
  network: 'sui:testnet',              // 'sui:testnet' | 'sui:mainnet' | 'sui:devnet'

  // Optional
  rpcUrl: 'https://fullnode.testnet.sui.io',  // custom RPC endpoint
  facilitatorUrl: 'https://your-facilitator.example.com', // default: SweeFi hosted
  packageId: '0xYOUR_SWEEFI_PACKAGE_ID',    // required for stream/escrow/seal schemes
});
```

### What you get back

```typescript
client.fetch            // wrapped fetch — auto-pays 402s
client.address          // Sui address of the paying wallet
client.network          // configured network string
client.s402Client       // underlying s402Client (advanced usage)
client.directSettlement // DirectSuiSettlement (bypasses facilitator)
client.facilitatorUrl   // resolved facilitator URL
```

### Advanced: wrap your own fetch

`wrapFetchWithS402` is also exported for cases where you have an existing fetch instance and want to upgrade it rather than replace it:

```typescript
import { wrapFetchWithS402 } from '@sweefi/sdk/client';

const paidFetch = wrapFetchWithS402(myCustomFetch, s402Client, {
  facilitatorUrl: 'https://your-facilitator.example.com',
  maxRetries: 1, // default
});
```

---

## Server — charging for your API

`s402Gate` is Hono middleware that turns any route into a paid endpoint. Unpaid requests get a `402 Payment Required` response with machine-readable payment instructions. Paid requests are verified and passed through.

```typescript
import { Hono } from 'hono';
import { s402Gate } from '@sweefi/sdk/server';

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

## How the s402 flow works

```
1. Agent sends request
   GET /api/data

2. Server responds 402
   HTTP 402 Payment Required
   X-PAYMENT-REQUIRED: <base64-encoded requirements>
   { "error": "Payment Required", "s402Version": "1" }

3. Client pays
   createS402Client reads the requirements, builds and signs a
   Sui transaction, encodes the payment proof, and retries:
   GET /api/data
   X-PAYMENT: <base64-encoded payment payload>

4. Server verifies and grants access
   s402Gate decodes the header, verifies via the facilitator,
   stores the receipt on context, calls next()
   → 200 OK with your actual response
```

The entire round-trip is handled by `client.fetch`. Your application code never sees the 402.

---

## Accepted payment schemes

| Scheme | When to use | Requires `packageId` |
|---|---|---|
| `exact` | Simple per-call payments. Always included. | No |
| `prepaid` | Deposit-and-draw billing for high-volume callers | Yes |
| `stream` | Rate-limited micropayment streams | Yes |
| `escrow` | Time-locked payments with arbiter | Yes |
| `unlock` | SEAL-based content unlocks | Yes |

Register only the schemes your API needs. On the client side, `packageId` is required to unlock any scheme beyond `exact`.

---

## Subpath imports

The package ships three entry points so you only bundle what you use:

```typescript
// Root — both client and server
import { createS402Client, s402Gate } from '@sweefi/sdk';

// Client only — safe in browser, edge, and agent environments
import { createS402Client, wrapFetchWithS402, adaptWallet } from '@sweefi/sdk/client';
import type { s402ClientConfig, s402FetchOptions } from '@sweefi/sdk/client';

// Server only — Hono middleware, Node.js and edge runtimes
import { s402Gate } from '@sweefi/sdk/server';
import type { s402GateConfig } from '@sweefi/sdk/server';
```

---

## Error handling

`client.fetch` throws `s402PaymentSentError` when a payment was submitted but the follow-up response was lost due to a network error. This is intentionally distinct from a normal fetch rejection — the payment may have already settled on-chain.

```typescript
import { s402PaymentSentError } from '@sweefi/sdk/client';

try {
  const res = await client.fetch('https://api.example.com/data');
} catch (err) {
  if (err instanceof s402PaymentSentError) {
    // Do NOT retry blindly. The payment may have already been processed.
    // Inspect err.requirements for amount/payTo, then verify on-chain.
    console.error('Payment sent but response lost:', err.requirements);
  }
}
```

---

## Peer dependencies

| Package | Required | Notes |
|---|---|---|
| `@mysten/sui` | Yes | `^1.20.0`. Keypairs, SuiClient, signing primitives. |
| `hono` | No (server only) | `>=4.0.0`. Only needed if you use `s402Gate`. |

---

## Ecosystem

| Package | Purpose |
|---|---|
| [`@sweefi/sdk`](https://www.npmjs.com/package/@sweefi/sdk) | This package — high-level SDK for clients and servers (includes types and client factories) |
| [`@sweefi/mcp`](https://www.npmjs.com/package/@sweefi/mcp) | 30 payment tools for Claude, Cursor, and any MCP-compatible AI |
| [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui) | Low-level Sui PTB builders for every on-chain operation |

---

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
