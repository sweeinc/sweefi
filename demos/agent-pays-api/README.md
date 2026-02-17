# s402 Agent Demo — AI Auto-Pays for API Access

An autonomous AI agent that auto-pays for premium API access using the s402 protocol on Sui testnet. No API keys. No subscriptions. Just HTTP 402 + crypto.

## What This Demonstrates

1. **Server** runs a Hono API with free + premium endpoints
2. **Agent** hits endpoints with a funded Sui wallet
3. Premium endpoints return **HTTP 402** with s402 payment requirements
4. Agent's s402 client **auto-detects** the protocol and **signs a payment** transaction
5. Agent **retries** the request with the `X-PAYMENT` header
6. Server **executes** the payment on Sui testnet and serves the data

The agent never knows prices upfront — it discovers them from 402 responses.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up your wallet key
#    Copy the example env file and add your testnet private key:
cp .env.example .env

#    Export from Sui CLI:
sui keytool export --key-identity <alias> --json | jq -r '.exportedPrivateKey'

#    Paste the base64 key into .env (SUI_PRIVATE_KEY=...)
#    Get testnet SUI: https://faucet.sui.io

# 3. Run the full demo
pnpm demo
```

> **Security**: Never pass private keys on the command line — they end up in
> shell history and `ps` output. The `.env` file is gitignored and loaded
> automatically via Node's `--env-file` flag (Node 20.6+).

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/weather` | Free | Basic weather data |
| `GET /api/forecast` | 1,000 MIST | 7-day premium forecast |
| `GET /api/alpha-signals` | 5,000 MIST | AI trading signals |
| `GET /.well-known/s402.json` | Free | Protocol discovery |

## Architecture

```
┌─────────────┐     HTTP 402      ┌──────────────┐
│   AI Agent   │ ←──────────────→ │  Hono Server │
│              │                  │              │
│ s402 Client  │  X-PAYMENT hdr   │  s402 Gate   │
│ (auto-pays)  │ ──────────────→  │  middleware   │
│              │                  │              │
│ Sui Wallet   │     200 + data   │  Sui Client  │
│ (Ed25519)    │ ←──────────────  │  (settles)   │
└─────────────┘                  └──────────────┘
       │                                │
       │         Sui Testnet            │
       └────────────────────────────────┘
              Signed TX → Execute
```

## The s402 Protocol Flow

```
Agent                    Server                  Sui Testnet
  │                        │                        │
  │── GET /api/forecast ──→│                        │
  │                        │                        │
  │←── 402 + requirements ─│                        │
  │    {amount: "1000",    │                        │
  │     asset: "SUI",      │                        │
  │     accepts: ["exact"]}│                        │
  │                        │                        │
  │ [auto-detect s402]     │                        │
  │ [sign payment TX]      │                        │
  │                        │                        │
  │── GET + X-PAYMENT ────→│                        │
  │                        │── execute signed TX ──→│
  │                        │                        │
  │                        │←── TX digest ──────────│
  │                        │                        │
  │←── 200 + forecast data │                        │
  │    + payment-response  │                        │
  │                        │                        │
```

## Why s402 > API Keys

| Feature | API Keys | s402 |
|---------|----------|------|
| Setup | Register, get key, configure | Just have a wallet |
| Billing | Monthly invoices, credit card | Pay-per-request, crypto |
| Access control | Centralized | Trustless (on-chain) |
| Agent-friendly | Need to manage keys | Just pay |
| Cross-platform | Per-provider | Universal standard |
| Revenue | Monthly subscription | Per-request micropayments |

## Cost

Each demo run costs ~6,000 MIST (0.000006 SUI) + gas on testnet. Essentially free.
