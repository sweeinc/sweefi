# Quick Start — AI Agent (Client)

Set up an AI agent that auto-pays for premium API data using the s402 protocol.

## Install

```bash
pnpm add @sweefi/sui @mysten/sui
```

## 10-Line Agent

```typescript
import { createS402Client } from '@sweefi/sui';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// 1. Load your Sui keypair (testnet — get SUI at https://faucet.sui.io)
const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY!);
const wallet = Ed25519Keypair.fromSecretKey(secretKey);

// 2. Create an s402-aware fetch client
const client = createS402Client({ wallet, network: 'sui:testnet' });

// 3. Fetch — if the server returns 402, the client auto-pays and retries
const response = await client.fetch('https://api.example.com/premium-data');
const data = await response.json();
console.log(data); // premium content, paid for on-chain
```

## What Just Happened

```
Agent                    API Server                  Sui
  |                        |                          |
  |── GET /premium ──────>|                          |
  |<── 402 + requirements ─|                          |
  |                        |                          |
  |  [build payment PTB]   |                          |
  |  [sign with keypair]   |                          |
  |                        |                          |
  |── GET + X-PAYMENT ───>|                          |
  |                        |── execute signed TX ───>|
  |                        |<── TX digest ───────────|
  |<── 200 + data ────────|                          |
```

1. Your agent sends a normal `GET` request
2. The server responds with **HTTP 402** and payment requirements (amount, token, recipient)
3. `createS402Client` detects the 402, builds a Sui PTB, signs it, and retries with the payment proof in an `X-PAYMENT` header
4. The server (or facilitator) executes the signed transaction on Sui
5. An on-chain `PaymentReceipt` is created — owned by the payer
6. The server returns the premium data

Cost: ~6,000 MIST (0.000006 SUI) + gas on testnet.

## Next Steps

- [Quick Start — Server](/guide/quickstart-server) — Gate your own endpoints with 402
- [MCP + Claude Desktop](/guide/mcp-setup) — Give Claude 30+ payment tools
- [Exact Payments](/guide/exact) — How one-shot payments work
- [Prepaid Budgets](/guide/prepaid) — ~70x gas savings for high-frequency APIs
- [@sweefi/sui Reference](/guide/sui) — Full PTB builder reference
