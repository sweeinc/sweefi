# Exact (One-Shot Payments)

The simplest scheme. One payment per request. Pay, get a receipt, done.

## When to Use

- Simple API calls (weather data, stock quotes, search results)
- x402 compatibility (exact is the only scheme x402 supports)
- Low-frequency access where per-call gas is acceptable

For high-frequency access (100+ calls/day), use [Prepaid](/guide/prepaid) instead — 500x gas savings.

## How It Works

```
Agent                    Server                   Sui
  |                        |                       |
  |── GET /data ──────────>|                       |
  |<── 402 + requirements ─|                       |
  |                        |                       |
  |  [buildPayTx]          |                       |
  |  [sign with keypair]   |                       |
  |                        |                       |
  |── GET + X-PAYMENT ────>|                       |
  |                        |── execute signed TX ──>|
  |                        |   payment::pay()      |
  |                        |   → PaymentReceipt    |
  |                        |<── TX digest ─────────|
  |<── 200 + data ─────────|                       |
```

Each request creates a new on-chain transaction. The `PaymentReceipt` is an owned object transferred to the payer — it can be used as a SEAL decryption credential.

## Code Example

### Client Side

```typescript
import { buildPayTx, testnetConfig } from '@sweefi/sui/ptb';
import { SuiClient } from '@mysten/sui/client';

const tx = buildPayTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: myAddress,
  recipient: '0xSERVER_ADDRESS',
  amount: 1_000_000n,        // 0.001 SUI
  feeMicroPercent: 5000,      // 0.5% fee
  feeRecipient: '0xFEE_ADDR',
  memo: new TextEncoder().encode('weather-api-call'),
});

const result = await suiClient.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
});
```

### With s402 Auto-Pay

```typescript
import { createS402Client } from '@sweefi/sui';

const client = createS402Client({ wallet: keypair, network: 'sui:testnet' });
const data = await client.fetch('https://api.example.com/premium');
// Automatic: 402 → build → sign → retry → data
```

### Server Side

```typescript
import { s402Gate } from '@sweefi/server';

app.use('/premium', s402Gate({
  price: '1000000',
  network: 'sui:testnet',
  payTo: '0xYOUR_ADDRESS',
  schemes: ['exact'],
}));
```

## On-Chain: `payment.move`

### `pay<T>()`

Creates a `PaymentReceipt` and transfers funds to the recipient.

```
Parameters:
  payment: Coin<T>       — coin to split payment from
  recipient: address     — who gets paid
  amount: u64            — gross amount (before fees)
  fee_micro_pct: u64     — fee rate (1,000,000 = 100%)
  fee_recipient: address — who gets the fee
  memo: vector<u8>       — arbitrary data (e.g., API endpoint)
  clock: &Clock

Returns: PaymentReceipt (owned by sender)
```

### PaymentReceipt

```
Fields:
  payer: address
  recipient: address
  amount: u64           — gross (before fees)
  fee_amount: u64       — computed fee
  token_type: String    — e.g., "0x2::sui::SUI"
  timestamp_ms: u64
  memo: vector<u8>
```

The receipt is an owned object with `key + store` — transferable and usable as a SEAL access condition.

### Invoices

For scenarios where the server initiates the payment request:

```typescript
import { buildCreateInvoiceTx, buildPayInvoiceTx } from '@sweefi/sui/ptb';

// Server creates invoice
const invoiceTx = buildCreateInvoiceTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: serverAddress,
  recipient: serverAddress,
  amount: 1_000_000n,
  feeMicroPercent: 5000,
  feeRecipient: feeAddress,
});

// Client pays invoice (invoice is consumed)
const payTx = buildPayInvoiceTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: clientAddress,
  invoiceId: '0xINVOICE_ID',
});
```

## Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `EInsufficientPayment` | Coin value < amount + fee |
| 1 | `EZeroAmount` | Payment amount is 0 |
| 2 | `EInvalidFeeMicroPct` | Fee > 1,000,000 (100%) |

## Next Steps

- [Prepaid](/guide/prepaid) — For high-frequency access (500x gas savings)
- [Streaming](/guide/streaming) — Per-second micropayments
- [SEAL](/guide/seal) — Use receipts for pay-to-decrypt
- [Fee & Trust Model](/guide/fee-ownership) — How micro-percent fees work
