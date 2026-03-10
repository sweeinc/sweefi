# SweeFi

> Give your AI agents a budget, not a blank check.

**Five payment schemes for AI agents on Sui — exact, prepaid, escrow, streaming, and SEAL pay-to-decrypt. 1,102 tests. 10 packages. Apache 2.0.**

```typescript
// 3 lines: AI agent auto-pays for premium data
import { createS402Client } from '@sweefi/sui';

const client = createS402Client({ wallet: myKeypair, network: 'sui:testnet' });
const data = await client.fetch('https://api.example.com/premium-data');
// 402 → auto-signs SUI payment → retries → returns data
```

## What Is This?

SweeFi is an open-source payment SDK for AI agents on Sui. Agents discover pricing via HTTP 402, pay on-chain, and get data back — autonomously. No API keys. No subscriptions. No human clicking "confirm."

Unlike raw crypto wallets, SweeFi gives humans control over what agents spend. Unlike Stripe or x402, that control is enforced on-chain — not by a platform:

- **Set a budget**: AP2 mandates with per-transaction, daily, and weekly caps
- **Four authorization levels**: L0 (single-use) through L3 (autonomous with caps) — no competitor has this
- **Verify independently**: Every payment produces an on-chain receipt. Sui validators verify — not a platform.
- **Revoke instantly**: Kill agent access via on-chain registry. Takes effect immediately.

SweeFi is the payment layer of the **Swee ecosystem**: **SweeFi** (payments + authorization) + **SweeAgent** (agent identity & reputation, `@sweeagent/*`) + **SweeWorld** (geo-location consumer app). This monorepo contains SweeFi — the foundation everything else builds on.

**s402** is a Sui-native HTTP 402 protocol that is wire-compatible with [x402](https://x402.org) but architecturally superior:

<!-- Architecture diagram source: docs/x402-vs-s402.mmd (Mermaid) — regenerate with: mmdc -i docs/x402-vs-s402.mmd -o docs/x402-vs-s402.png -->

| Feature | x402 (EVM) | s402 (Sui) |
|---------|-----------|-----------|
| Settlement | Verify first, settle later (temporal gap) | Atomic PTBs (no gap) |
| Payment modes | Exact only | Exact, Prepaid, Escrow, Stream, Seal |
| Micro-payments | ~$1 gas per 1K calls (Base L2, per-call settlement) | $0.014 gas per 1K calls via prepaid batching |
| Agent authorization | None | AP2 Mandates (spending limits) |
| Content gating | Server-trust (server controls access) | Trustless (SEAL threshold encryption) |
| Finality | ~12s (Ethereum L1), ~2s (Base L2) | ~400ms (Sui) |
| Facilitator | Required (trust bottleneck) | Optional (direct settlement) |
| Receipts | Off-chain | On-chain NFTs |
| Security model | Sign-first (facilitator holds signed txs) | Settle-first (atomic on-chain) |

## Which Package Do I Need?

| I want to... | Install | Start here |
|---|---|---|
| **Charge per API call** (server-side paywall) | `@sweefi/server` + `@sweefi/sui` | [`s402Gate` middleware](packages/server#server--charging-for-your-api) |
| **Build an AI agent that auto-pays APIs** | `@sweefi/sui` | [`createS402Client`](packages/sui#quick-start) |
| **Give my AI agent payment tools** (Claude, Cursor) | `@sweefi/mcp` | [MCP quickstart](packages/mcp#quickstart) |
| **Pay from a CLI / script** | `@sweefi/cli` | [`sweefi pay`](packages/cli#quick-start) |
| **Pay from a Solana wallet** | `@sweefi/solana` | [Solana adapter](packages/solana#quick-start) |
| **Bridge AP2 mandates to SweeFi** | `@sweefi/ap2-adapter` | [AP2 adapter](packages/ap2-adapter#quick-start) |
| **Add a pay button to React** | `@sweefi/react` + `@sweefi/sui` + `@sweefi/ui-core` | [`useSweefiPayment()`](packages/react#provider-mode-recommended-for-apps) |
| **Add a pay button to Vue** | `@sweefi/vue` + `@sweefi/sui` + `@sweefi/ui-core` | [`useSweefiPayment()`](packages/vue#plugin-mode-recommended-for-apps) |
| **Build Move transactions directly** | `@sweefi/sui` | [`@sweefi/sui/ptb` builders](packages/sui#ptb-builder-reference) |
| **Just use the protocol types** | `s402` | [s402 on npm](https://www.npmjs.com/package/s402) |

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

## Payment Schemes

### Deployed Schemes (Sui Testnet)

| Scheme | Use Case | How It Works | Status |
|--------|----------|-------------|--------|
| **Exact** | One-shot API calls | Sign transfer, execute, done | **Deployed, facilitator complete** |
| **Prepaid** | AI agent API budgets, high-frequency access | Deposit funds → off-chain API calls → provider batch-claims | **Deployed, facilitator complete** |
| **Escrow** | Digital goods, freelance work | Lock funds, release on delivery, refund on deadline | **Deployed, 11 PTB builders** |
| **Stream** | Continuous access (AI inference, video) | Create stream on first 402, use stream-id for ongoing access | **Deployed, 9 PTB builders** |
| **Seal** | Pay-to-decrypt (trustless content gating) | Pay → receipt → SEAL key servers release decryption key | **Token-gated deployed** |

**Pay per call. Fund agent budgets. Trade trustlessly. Stream micropayments. Gate content.** x402 gives you the first one. SweeFi gives you all five.

### Future Schemes

| Scheme | Use Case | Status |
|--------|----------|--------|
| **Unlock** | Receipt-gated SEAL decryption | Client scheme exists, facilitator handler planned |
| **Split** | Multi-party settlement (royalties, affiliates) | Planned |

**Together these enable autonomous digital commerce with human control.** A human sets a mandate ("spend up to $10/day on weather APIs"). An AI agent operates within those bounds — calling APIs (exact), depositing budgets (prepaid), trading trustlessly (escrow), streaming micropayments (stream), and decrypting content (seal). Every action produces an on-chain receipt. Mandates expire on schedule and can be revoked instantly. No platform taking 30%. See [SPEC.md](SPEC.md) for the full vision.

### Why This Matters (The Authorization Gap)

Every payment primitive above is backed by the same authorization architecture:

| What you need | How SweeFi does it | What others do |
|---|---|---|
| **Set spending intent** | AP2 mandates ("$10/day on these APIs") | Stripe: platform-controlled limits. x402: none. |
| **Bound what agents can do** | L0-L3 levels + per-tx/daily/weekly caps | No competitor has tiered authorization |
| **Verify what happened** | On-chain receipts, Sui validators | Off-chain logs (trust the platform) |
| **Revoke access** | On-chain registry, instant | API key rotation (delayed, error-prone) |

This is what separates SweeFi from raw crypto payments (no controls) and from platform payments (controls, but you trust the platform). SweeFi enforces controls on-chain — the agent literally cannot violate them.

## Architecture

<!-- Architecture diagram source: docs/architecture.mmd (Mermaid) — regenerate with: mmdc -i docs/architecture.mmd -o docs/architecture.png -->

```
AI Agent (Claude, GPT, Cursor, etc.)
    |
    +-- s402 fetch wrapper ------> @sweefi/sui (createS402Client — auto-pay)
    |                                   |
    +-- MCP tool discovery -------> @sweefi/mcp (35 tools)
    |                                   |
    +-- Direct PTB --------------> @sweefi/sui (40 PTB builders)
    |                                   |
    +-- CLI ----------------------> @sweefi/cli
    |                                   |
    |                         s402 (protocol spec, npm package)
    |                                   |
    |                         @sweefi/server (s402Gate, wrapFetchWithS402)
    |                                   |
    |                         @sweefi/facilitator (verify + settle — self-hostable)
    |
    +-- Vue UI ------------------> @sweefi/vue + @sweefi/ui-core
    +-- React UI ----------------> @sweefi/react + @sweefi/ui-core
    |
    +-- Agent identity ----------> @sweeagent/identity   [FUTURE]
    +-- Agent reputation --------> @sweeagent/reputation [FUTURE]
    +-- Agent discovery ---------> @sweeagent/registry   [FUTURE]
                                        |
                              Sui blockchain (10 Move modules, testnet)
                                        |
                                 +------+------+
                                 |  payment    | Direct pay + receipts
                                 |  stream     | Micropayments + budget caps
                                 |  escrow     | Time-locked + arbiter disputes
                                 |  seal_policy| Pay-to-decrypt via SEAL
                                 |  prepaid    | Deposit-based agent budgets
                                 |  mandate    | AP2 agent spending limits
                                 |  agent_mndt | L0-L3 progressive autonomy
                                 |  identity   | Agent identity (did:sui)
                                 |  math       | Shared arithmetic utils
                                 |  admin      | Protocol governance
                                 +-------------+
```

## Packages

| Package | Description | Tests |
|---------|-------------|-------|
| [`@sweefi/ui-core`](packages/ui-core) | Framework-agnostic state machine + `PaymentAdapter` interface | 13 |
| [`@sweefi/server`](packages/server) | Chain-agnostic HTTP: `s402Gate` middleware + `wrapFetchWithS402` | — |
| [`@sweefi/sui`](packages/sui) | 40 PTB builders + `SuiPaymentAdapter` + s402 client | 257 |
| [`@sweefi/vue`](packages/vue) | Vue 3 plugin + `useSweefiPayment()` composable | 10 |
| [`@sweefi/react`](packages/react) | React context + `useSweefiPayment()` hook (`useSyncExternalStore`) | 12 |
| [`@sweefi/facilitator`](packages/facilitator) | Self-hostable payment verification — Docker/Fly.io (not on npm) | 63 |
| [`@sweefi/mcp`](packages/mcp) | MCP server with 35 AI agent tools | 124 |
| [`@sweefi/cli`](packages/cli) | CLI tool — wallet, pay, prepaid, mandates | 238 |
| [`@sweefi/solana`](packages/solana) | Solana s402 payment adapter | 40 |
| [`@sweefi/ap2-adapter`](packages/ap2-adapter) | Google AP2 ↔ SweeFi mandate bridge | 52 |
| [`sweefi-contracts`](contracts) | 10 Move modules on Sui testnet | 293 |

**Total: 1,102 passing tests (809 TypeScript + 293 Move)**

**External**: [`s402`](https://www.npmjs.com/package/s402) (HTTP 402 protocol, v0.2.2), `@mysten/sui@2.6.0`, `@mysten/seal@1.0.1`

## Try It Now

### 1. Run the demo locally (needs testnet wallet)

```bash
# Get testnet SUI: https://faucet.sui.io
cd demos/agent-pays-api
pnpm install
SUI_PRIVATE_KEY=<base64-key> pnpm demo
```

The demo starts a Hono server with free + premium endpoints, then runs an agent that:
1. Hits free endpoint (200, no payment)
2. Hits premium endpoint (402, auto-detects s402, signs payment, retries)
3. Gets premium data back with on-chain settlement proof

Cost: ~6,000 MIST (0.000006 SUI) + gas on testnet.

### 2. Verify on-chain (no wallet needed)

View real demo transactions on Sui testnet:
- [payment::pay](https://suiscan.xyz/testnet/tx/Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK) — 1,000,000 MIST direct settlement
- [stream::create](https://suiscan.xyz/testnet/tx/GDo8g5Yu1X1zCdaLTtEVCqxeWJqkDDyoHjdGP5TLvkhf) — streaming micropayment meter
- [escrow::create](https://suiscan.xyz/testnet/tx/EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR) — time-locked conditional payment

All three invoke Move contracts on [package v11](https://suiscan.xyz/testnet/object/0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5).

## Quick Start

### AI agent paying for APIs (client)

```typescript
import { createS402Client } from '@sweefi/sui';
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
import { s402Gate } from '@sweefi/server';

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
import { buildCreateStreamTx } from '@sweefi/sui/ptb';
import { ZERO_ADDRESS } from '@sweefi/sui';

const tx = buildCreateStreamTx(config, {
  coinType: '0x2::sui::SUI',
  sender: myAddress,
  recipient: agentAddress,
  depositAmount: 1_000_000_000n,  // 1 SUI
  ratePerSecond: 1_000_000n,      // 0.001 SUI/sec
  budgetCap: 5_000_000_000n,      // Max 5 SUI total
  feeMicroPercent: 0,
  feeRecipient: ZERO_ADDRESS,
});
```

### AP2 Mandate (agent spending authorization)

```typescript
import { buildCreateMandateTx, buildMandatedPayTx } from '@sweefi/sui/ptb';
import { ZERO_ADDRESS } from '@sweefi/sui';

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
  feeMicroPercent: 0,
  feeRecipient: ZERO_ADDRESS,
});
```

## MCP Tools (AI-Native)

Any MCP-compatible AI agent can discover and use 35 tools (30 default + 5 opt-in):

**Payments** (4): `pay`, `pay_and_prove`, `create_invoice`, `pay_invoice`
**Streaming** (4): `start_stream`, `start_stream_with_timeout`, `stop_stream`, `recipient_close_stream`
**Escrow** (4): `create_escrow`, `release_escrow`, `refund_escrow`, `dispute_escrow`
**Prepaid** (7): `prepaid_deposit`, `prepaid_top_up`, `prepaid_request_withdrawal`, `prepaid_finalize_withdrawal`, `prepaid_cancel_withdrawal`, `prepaid_agent_close`, `prepaid_status`
**Mandates** (7): `create_mandate`, `create_agent_mandate`, `basic_mandated_pay`, `agent_mandated_pay`, `revoke_mandate`, `create_registry`, `inspect_mandate`
**Read-Only** (4): `check_balance`, `check_payment`, `get_receipt`, `supported_tokens`
**Opt-In Provider** (1): `prepaid_claim`
**Opt-In Admin** (4): `protocol_status`, `pause_protocol`, `unpause_protocol`, `burn_admin_cap`

All tool names prefixed with `sweefi_`. Transaction tools require `SUI_PRIVATE_KEY` env var.

### Claude Desktop Setup

```json
{
  "mcpServers": {
    "sweefi": {
      "command": "node",
      "args": ["packages/mcp/dist/cli.mjs"],
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

Deployed on Sui testnet. 10 modules, 293 Move tests, AdminCap + ProtocolState for governance.

| Module | Purpose |
|--------|---------|
| `payment` | Direct payments, invoices, receipts |
| `stream` | Streaming micropayments with budget caps |
| `escrow` | Time-locked escrow with arbiter disputes |
| `seal_policy` | SEAL integration for pay-to-decrypt |
| `prepaid` | Deposit-based agent budgets with rate-capped batch claims |
| `mandate` | Basic AP2 spending delegation + revocation |
| `agent_mandate` | L0-L3 progressive autonomy with lazy daily/weekly reset |
| `identity` | Agent identity profiles (did:sui) |
| `math` | Shared arithmetic utilities (safe division, BPS) |
| `admin` | AdminCap, ProtocolState, pause/unpause/burn |

Package ID (testnet): `0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5`

Token-gated SEAL (standalone): `0xbf9f9d63cbe53f21ac81af068e25e2c736fa2b0537c7e34d7d2862e330fe4fbc`

## Known Limitations

### zkLogin not supported in facilitator signature verification

`toFacilitatorSuiSigner`'s `verifySignature()` supports Ed25519 and Secp256k1 signatures only. zkLogin verification requires a `SuiGraphQLClient` and is not yet implemented. Agents signing transactions with zkLogin wallets will fail verification at the facilitator layer.

**Workaround**: Use Ed25519Keypair or Secp256k1Keypair for agent wallets when using the hosted or self-hosted facilitator.

### Identity module: only records PaymentReceipt

The on-chain `identity.move` module (agent profiles, `did:sui`) currently records volume for `payment::PaymentReceipt` events only. `EscrowReceipt`, stream activity, and prepaid usage do **not** update the agent's on-chain reputation counters. TypeScript PTB builders for the identity module are not yet implemented.

**Impact**: Agent identity/reputation metrics reflect direct payments only. Stream, escrow, and prepaid-based agents will show artificially low on-chain activity until identity PTBs are added.

### SEAL mainnet key servers not yet configured

`@sweefi/server`'s `NETWORKS.mainnet.sealKeyServers` is an empty array. SEAL pay-to-decrypt on mainnet requires populating key server object IDs once Mysten Labs publishes mainnet key servers.

---

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

- [s402](https://github.com/s402-protocol/core) — Sui-native HTTP 402 protocol ([npm](https://www.npmjs.com/package/s402))
- [Sui](https://sui.io) — High-performance L1 with PTBs and ~400ms finality
- [SEAL](https://docs.sui.io/concepts/cryptography/seal) — Sui's threshold encryption for programmable access control
- [x402](https://x402.org) — Coinbase's HTTP 402 payment protocol (wire-compatible)
- [MCP](https://modelcontextprotocol.io) — Anthropic's Model Context Protocol
- [Hono](https://hono.dev) — Lightweight web framework
- [@mysten/sui](https://github.com/MystenLabs/ts-sdks) — Official Sui TypeScript SDK

## The Swee Ecosystem

SweeFi is the payment layer. The broader ecosystem includes:

| Brand | Role | Status |
|-------|------|--------|
| **s402** | Open protocol standard (`s402` npm package) | Shipped, Apache 2.0 |
| **SweeFi** | Open source payment SDK (`@sweefi/*`) | Shipping, Apache 2.0 |
| **SweeWorld** | Free agent dashboard — see your agents spend, know they can't overspend | Vision |
| **SweeCard** | TradFi/crypto bridge card | Phase 3+, backburner |

See [SPEC.md](SPEC.md) for the full vision and roadmap.

## Open Source

SweeFi is fully open source. Every developer-facing package is published under **Apache 2.0** — which includes an explicit patent grant, making it safe for commercial use in financial software.

| Package | License | Published |
|---------|---------|-----------|
| `s402` | Apache 2.0 | npm (public) |
| `@sweefi/ui-core` | Apache 2.0 | npm (public) |
| `@sweefi/server` | Apache 2.0 | npm (public) |
| `@sweefi/sui` | Apache 2.0 | npm (public) |
| `@sweefi/vue` | Apache 2.0 | npm (public) |
| `@sweefi/react` | Apache 2.0 | npm (public) |
| `@sweefi/mcp` | Apache 2.0 | npm (public) |
| `@sweefi/cli` | Apache 2.0 | npm (public) |
| `@sweefi/solana` | Apache 2.0 | npm (public) |
| `@sweefi/ap2-adapter` | Apache 2.0 | npm (public) |
| `@sweefi/facilitator` | Apache 2.0 | Self-hostable (not on npm) |
| `sweefi-contracts` | Apache 2.0 | Deployed on Sui |

The facilitator source is open — you can read it, audit it, and self-host it. SweeFi also runs a **managed facilitator** as a hosted service (the default in `@sweefi/server` and `@sweefi/sui`). Self-hosting is always an option. See [`packages/facilitator`](packages/facilitator) for Docker and Fly.io deployment instructions.

## License

Apache 2.0 — see [LICENSE](LICENSE)
