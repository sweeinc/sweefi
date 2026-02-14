# SweePay

> **s402** — Sui-native HTTP 402 payments for the agentic economy.

**AI agents that can pay, stream, escrow, and prove — natively on-chain. No API keys. No subscriptions. Just HTTP 402 + crypto.**

```typescript
// 3 lines: AI agent auto-pays for premium data
import { createS402Client } from '@sweepay/sdk/client';

const client = createS402Client({ wallet: myKeypair, network: 'sui:testnet' });
const data = await client.fetch('https://api.example.com/premium-data');
// 402 → auto-signs SUI payment → retries → returns data
```

## What Is This?

SweePay is payment infrastructure purpose-built for the agentic economy. AI agents need to pay for APIs, computing resources, and digital goods — without human intervention, credit cards, or centralized custody.

**s402** is a Sui-native HTTP 402 protocol that is wire-compatible with [x402](https://x402.org) but architecturally superior:

| Feature | x402 (EVM) | s402 (Sui) |
|---------|-----------|-----------|
| Settlement | Verify first, settle later (temporal gap) | Atomic PTBs (no gap) |
| Payment modes | Exact only | Exact + Stream + Escrow + SEAL |
| Agent authorization | None | AP2 Mandates (spending limits) |
| Content gating | Server-trust (server controls access) | Trustless (SEAL threshold encryption) |
| Finality | ~12s (Ethereum) | ~2-3s (Sui) |
| Facilitator | Required | Optional (direct settlement) |
| Receipts | Off-chain | On-chain NFTs |

## The s402 Protocol

```
Agent                    Server                  Sui Testnet
  |                        |                        |
  |-- GET /api/data ------>|                        |
  |                        |                        |
  |<-- 402 + requirements -|                        |
  |    {s402Version: "1",  |                        |
  |     amount: "1000",    |                        |
  |     accepts: ["exact"]}|                        |
  |                        |                        |
  | [auto-detect s402]     |                        |
  | [sign payment TX]      |                        |
  |                        |                        |
  |-- GET + X-PAYMENT ---->|                        |
  |                        |-- execute signed TX -->|
  |                        |                        |
  |                        |<-- TX digest ----------|
  |                        |                        |
  |<-- 200 + data ---------|                        |
  |    + payment-response  |                        |
```

**Key insight**: The agent never knows prices upfront. It discovers requirements via the 402 response and pays automatically. Works across any API, any price, any payment scheme.

## Four Payment Schemes

| Scheme | Use Case | How It Works | Status |
|--------|----------|-------------|--------|
| **Exact** | One-shot API calls | Sign transfer, execute, done | **E2E demo'd** |
| **Stream** | Metered access (AI inference, video) | Create stream on first 402, use stream-id for ongoing access | Contracts deployed, HTTP integration ready |
| **Escrow** | Digital goods, freelance work | Lock funds, release on delivery, refund on deadline | Contracts deployed, HTTP integration ready |
| **SEAL** | Pay-to-decrypt (trustless content gating) | Pay → receipt → SEAL key servers release decryption key | Token-gated deployed, receipt-gated in progress |

## Architecture

```
AI Agent (Claude, GPT, Cursor, etc.)
    |
    +-- s402 fetch wrapper ------> @sweepay/sdk (auto-pay client)
    |                                   |
    +-- MCP tool discovery -------> @sweepay/mcp (16 tools)
    |                                   |
    +-- Direct PTB --------------> @sweepay/sui (22 PTB builders)
                                        |
                                 @sweepay/facilitator (verify + settle)
                                        |
                                 Sui blockchain (5 Move modules, 89 on-chain tests)
                                        |
                                 +------+------+
                                 |  payment    | Direct pay + receipts
                                 |  stream     | Micropayments + budget caps
                                 |  escrow     | Time-locked + arbiter disputes
                                 |  seal_policy| Pay-to-decrypt via SEAL
                                 |  mandate    | AP2 agent spending limits
                                 +-------------+
```

## Packages

| Package | Description | Tests |
|---------|-------------|-------|
| [`@sweepay/sdk`](packages/sdk) | Client + server SDK (3-line integration) | 30 |
| [`@sweepay/sui`](packages/sui) | 22 PTB builders for all contract operations | 118 |
| [`@sweepay/facilitator`](packages/facilitator) | Self-hostable payment verification service | 37 |
| [`@sweepay/core`](packages/core) | s402 protocol types, client, scheme interfaces | 85 |
| [`@sweepay/mcp`](packages/mcp) | MCP server with 16 AI agent tools | 36 |
| [`@sweepay/widget`](packages/widget) | Checkout UI — Vue + React adapters | 6 |
| [`sweepay-contracts`](contracts) | 5 Move modules on Sui testnet | 89 |

**Total: 411 tests (310 TypeScript + 101 Move)**

## Live Agent Demo

See it work end-to-end: an AI agent auto-pays for premium API access on Sui testnet.

```bash
cd demos/agent-pays-api
pnpm install
SUI_PRIVATE_KEY=<base64-key> pnpm demo
```

The demo starts a Hono server with free + premium endpoints, then runs an agent that:
1. Hits free endpoint (200, no payment)
2. Hits premium endpoint (402, auto-detects s402, signs payment, retries)
3. Gets premium data back with on-chain settlement proof

Cost: ~6,000 MIST (0.000006 SUI) + gas on testnet.

## Quick Start

### AI agent paying for APIs (client)

```typescript
import { createS402Client } from '@sweepay/sdk/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const wallet = Ed25519Keypair.fromSecretKey(myKey);
const client = createS402Client({
  wallet,
  network: 'sui:testnet',
});

// Any fetch to a 402-gated endpoint auto-pays
const response = await client.fetch('https://api.example.com/premium');
```

### API provider gating endpoints (server)

```typescript
import { Hono } from 'hono';
import { s402Gate } from '@sweepay/sdk/server';

const app = new Hono();

app.use('/premium', s402Gate({
  price: '1000000',        // 0.001 SUI
  network: 'sui:testnet',
  payTo: '0xYOUR_ADDRESS',
  schemes: ['exact'],      // Also supports: stream, escrow, seal
}));

app.get('/premium', (c) => c.json({ data: 'premium content' }));
```

### Streaming payment with budget cap

```typescript
import { buildCreateStreamTx } from '@sweepay/sui/ptb';

const tx = buildCreateStreamTx(config, {
  coinType: '0x2::sui::SUI',
  sender: myAddress,
  recipient: agentAddress,
  depositAmount: 1_000_000_000n,  // 1 SUI
  ratePerSecond: 1_000_000n,      // 0.001 SUI/sec
  budgetCap: 5_000_000_000n,      // Max 5 SUI total
  feeBps: 0,
  feeRecipient: ZERO_ADDRESS,
});
```

### AP2 Mandate (agent spending authorization)

```typescript
import { buildCreateMandateTx, buildMandatedPayTx } from '@sweepay/sui/ptb';

// Human creates mandate for AI agent
const createTx = buildCreateMandateTx(config, {
  coinType: '0x2::sui::SUI',
  sender: humanAddress,
  delegate: agentAddress,
  maxPerTx: 1_000_000n,           // 0.001 SUI per transaction
  maxTotal: 100_000_000n,         // 0.1 SUI lifetime cap
  expiresAtMs: BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
});

// Agent pays with mandate validation (atomic)
const payTx = buildMandatedPayTx(config, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  recipient: merchantAddress,
  amount: 500_000n,
  mandateId: '0xMANDATE_OBJECT_ID',
  feeBps: 0,
  feeRecipient: ZERO_ADDRESS,
});
```

## MCP Tools (AI-Native)

Any MCP-compatible AI agent can discover and use these 16 tools:

| Tool | Description |
|------|-------------|
| `sweepay_pay` | Direct payment with optional fee + memo |
| `sweepay_pay_and_prove` | Atomic pay + receipt (SEAL flow) |
| `sweepay_create_invoice` | Create payment invoice NFT |
| `sweepay_pay_invoice` | Pay an existing invoice |
| `sweepay_start_stream` | Start streaming micropayment with budget cap |
| `sweepay_stop_stream` | Close stream, refund remaining deposit |
| `sweepay_create_escrow` | Create time-locked escrow with arbiter |
| `sweepay_release_escrow` | Release funds to seller |
| `sweepay_refund_escrow` | Refund to buyer (permissionless after deadline) |
| `sweepay_dispute_escrow` | Raise dispute, lock to arbiter resolution |
| `sweepay_check_balance` | Check SUI/USDC/USDT balance |
| `sweepay_check_payment` | Query payment history |
| `sweepay_get_receipt` | Fetch receipt details |
| `sweepay_supported_tokens` | List supported tokens |

### Claude Desktop Setup

```json
{
  "mcpServers": {
    "sweepay": {
      "command": "node",
      "args": ["packages/mcp/dist/index.mjs"],
      "env": {
        "SUI_NETWORK": "testnet",
        "SUI_PRIVATE_KEY": "<base64 Ed25519 key>"
      }
    }
  }
}
```

## Safety Design

Every payment primitive includes permissionless recovery so funds never get stuck:

- **Streams**: Budget cap is a hard kill switch. Recipient can force-close abandoned streams after timeout.
- **Escrow**: After the deadline, _anyone_ can trigger a refund. Arbiter resolves disputes before deadline.
- **Mandates**: Per-transaction limits + lifetime caps + expiry. Delegator can revoke via on-chain registry.
- **Receipts**: On-chain PaymentReceipt and EscrowReceipt serve as SEAL decryption credentials.

No admin keys control user funds.

## Smart Contracts

Deployed on Sui testnet. 5 modules, 101 Move tests, v6.

| Module | Purpose |
|--------|---------|
| `payment` | Direct payments, invoices, receipts |
| `stream` | Streaming micropayments with budget caps |
| `escrow` | Time-locked escrow with arbiter disputes |
| `seal_policy` | SEAL integration for pay-to-decrypt |
| `mandate` | AP2 agent spending authorization |

Package ID (testnet v6): `0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5`

Token-gated SEAL (standalone): `0xbf9f9d63cbe53f21ac81af068e25e2c736fa2b0537c7e34d7d2862e330fe4fbc`

## x402 Compatibility

s402 is wire-compatible with x402. An s402 server always includes `"exact"` in its `accepts` array, so x402 clients can talk to s402 servers without modification. s402 clients auto-detect x402 servers via protocol detection (presence of `s402Version` field).

This means you can adopt s402 incrementally without breaking existing x402 integrations.

## Development

```bash
# Install
pnpm install

# Build all packages
pnpm -r build

# Run tests
pnpm -r test

# Typecheck
pnpm -r typecheck

# Move tests
cd contracts && sui move test

# Run agent demo
cd demos/agent-pays-api && SUI_PRIVATE_KEY=<key> pnpm demo
```

## Built On

- [Sui](https://sui.io) — High-performance L1 with PTBs and ~2s finality
- [SEAL](https://docs.sui.io/concepts/cryptography/seal) — Sui's threshold encryption for programmable access control
- [x402](https://x402.org) — Coinbase's HTTP 402 payment protocol (wire-compatible)
- [MCP](https://modelcontextprotocol.io) — Anthropic's Model Context Protocol
- [Hono](https://hono.dev) — Lightweight web framework
- [@mysten/sui](https://github.com/MystenLabs/ts-sdks) — Official Sui TypeScript SDK

## License

MIT — see [LICENSE](LICENSE)
