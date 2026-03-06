# Self-Hosting the Facilitator

The facilitator is the settlement service that verifies signed payments and broadcasts them to Sui. It sits between your API server and the blockchain.

## What It Does

```
Client                API Server              Facilitator             Sui
  |── GET + payment ──>|                         |                      |
  |                    |── POST /s402/process ──>|                      |
  |                    |                         |── execute signed TX ─>|
  |                    |                         |<── TX digest ────────|
  |                    |<── settlement proof ────|                      |
  |<── 200 + data ─────|                         |                      |
```

The facilitator:
- **Verifies** the signed transaction matches the payment requirements
- **Broadcasts** the transaction to Sui
- **Returns** the settlement proof (TX digest, receipt ID)
- **Never** holds funds or private keys — it's a relay

## Quick Start (Local)

```bash
cd packages/facilitator

# Set required env vars
export API_KEYS="$(openssl rand -hex 32)"
export SUI_TESTNET_RPC="https://fullnode.testnet.sui.io:443"

# Run locally
pnpm dev
# Listening on http://localhost:4022
```

Test it:

```bash
curl http://localhost:4022/health
# {"status":"ok","timestamp":"2026-02-28T12:00:00.000Z"}

curl http://localhost:4022/.well-known/s402-facilitator
# {"version":"1","feeMicroPercent":5000,"feeRecipient":null,"minFeeUsd":"0.001","supportedSchemes":["exact","stream","escrow","unlock","prepaid"],"supportedNetworks":["sui:testnet"],"validUntil":"..."}
```

## Docker Deployment

```dockerfile
FROM node:22-slim AS base
RUN corepack enable pnpm

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sweefi/facilitator... build
RUN pnpm --filter @sweefi/facilitator deploy /deploy --prod

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
EXPOSE 4022
CMD ["node", "dist/index.mjs"]
```

**Note**: Build from the monorepo root, not from `packages/facilitator/`.

```bash
# Build from monorepo root (needs -f to find the Dockerfile)
docker build -f packages/facilitator/Dockerfile -t sweefi-facilitator .
docker run -p 4022:4022 \
  -e API_KEYS="$(openssl rand -hex 32)" \
  sweefi-facilitator
```

## Fly.io Deployment

The facilitator includes a `fly.toml` for one-command deployment:

```bash
cd packages/facilitator

# First deploy
fly launch

# Set secrets
fly secrets set API_KEYS="$(openssl rand -hex 32)"

# Deploy
fly deploy
```

The `fly.toml` is configured for:
- `shared-cpu-1x` with 512 MB RAM
- Auto-stop excess machines when idle (1 machine minimum), auto-start on request
- Port 4022 internal, 443 external (TLS termination by Fly)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEYS` | Yes | — | Comma-separated bearer tokens (each ≥16 chars) |
| `PORT` | No | `4022` | HTTP port |
| `FEE_MICRO_PERCENT` | No | `5000` | Fee rate in micro-percent (5000 = 0.5%, where 1,000,000 = 100%) |
| `FEE_RECIPIENT` | No | — | Fee recipient address |
| `FACILITATOR_KEYPAIR` | No | — | Base64 Ed25519 (reserved for gas sponsorship) |
| `SUI_MAINNET_RPC` | No | — | Custom mainnet RPC URL |
| `SUI_TESTNET_RPC` | No | — | Custom testnet RPC URL |
| `SWEEFI_PACKAGE_ID` | No | — | Anti-spoofing: reject TXs targeting wrong package |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_TOKENS` | No | `100` | Token bucket capacity per API key |
| `RATE_LIMIT_REFILL_RATE` | No | `10` | Tokens/second refill rate |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Liveness probe |
| `GET` | `/ready` | No | Readiness probe (checks RPC connectivity) |
| `GET` | `/.well-known/s402-facilitator` | No | Facilitator identity + capabilities |
| `GET` | `/.well-known/s402.json` | No | s402 discovery document |
| `GET` | `/supported` | No | Networks and schemes |
| `POST` | `/verify` | Yes | Verify payment without broadcasting |
| `POST` | `/settle` | Yes | Verify + broadcast to Sui |
| `POST` | `/s402/process` | Yes | Atomic verify + settle (recommended) |
| `GET` | `/settlements` | Yes | Per-key settlement history |

## Security Model

- **API key auth**: Constant-time SHA-256 comparison. Each key must be ≥16 characters.
- **Rate limiting**: Token bucket per API key (100 burst, 10/sec refill)
- **Request size**: 256 KB max body
- **Anti-spoofing**: When `SWEEFI_PACKAGE_ID` is set, rejects transactions targeting wrong contract
- **Non-custodial**: The facilitator cannot extract funds, forge receipts, or redirect payments. It is a relay.
- **Idempotent dedup**: Duplicate `/settle` or `/s402/process` requests return cached results with `X-Idempotent-Replay: true` (60s TTL)

## Supported Schemes

The facilitator supports five schemes:

| Scheme | Description |
|--------|-------------|
| `exact` | One-shot payment per request |
| `prepaid` | Deposit-based agent budgets |
| `stream` | Per-second streaming micropayments |
| `escrow` | Time-locked escrow with dispute resolution |
| `unlock` | Pay-to-decrypt encrypted content (Walrus + SEAL) |

## Next Steps

- [Quick Start — Server](/guide/quickstart-server) — Wire up `s402Gate` to your facilitator
- [Fee & Trust Model](/guide/fee-ownership) — How fees work
- [Exact Payments](/guide/exact) — Settlement flow details
