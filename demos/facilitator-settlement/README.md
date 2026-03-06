# Demo #2 — Facilitator-as-a-Service

Three-party s402 settlement demonstrating SweeFi's business model.

## Architecture

```
Agent                    Server A (API)           Server B (Facilitator)     Sui Testnet
  │                         │                         │                         │
  │──GET /api/forecast─────▶│                         │                         │
  │◀─────────── 402 ────────│                         │                         │
  │  (payment requirements) │                         │                         │
  │                         │                         │                         │
  │  [signs PTB locally]    │                         │                         │
  │                         │                         │                         │
  │──GET /api/forecast─────▶│                         │                         │
  │  (X-PAYMENT header)     │──POST /s402/process────▶│                         │
  │                         │  (forward payment)      │──execute TX────────────▶│
  │                         │                         │◀─────── TX digest ──────│
  │                         │◀─────── result ─────────│  [meters settlement]    │
  │◀─────────── 200 ────────│                         │                         │
  │  (premium data)         │                         │                         │
```

**Key insight**: Server A has zero Sui SDK imports. It delegates all settlement to the facilitator via a single HTTP call. The agent doesn't know the facilitator exists.

## Run

```bash
cp .env.example .env    # add SUI_PRIVATE_KEY
pnpm install            # from monorepo root
pnpm demo
```

## What it proves

1. **Settlement delegation** — API providers need zero blockchain knowledge
2. **Metering** — Facilitator tracks every settlement per API key
3. **Revenue model** — Facilitators charge for settlement-as-a-service
4. **Agent transparency** — Agents don't know or care about the facilitator

## Requirements

- Funded Sui testnet wallet (~0.1 SUI for gas + payments)
- Get testnet SUI: https://faucet.sui.io
