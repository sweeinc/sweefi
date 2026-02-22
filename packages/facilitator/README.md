# @sweefi/facilitator

Self-hostable payment verification and settlement service for the s402 sign-first payment protocol on Sui.

Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

---

## What it is

The facilitator is the off-chain settlement server in SweeFi's s402 payment flow. When a client wants to pay for a resource, it builds and signs a Sui transaction locally, then sends that signed payload here. The facilitator verifies the signature and payment requirements, broadcasts the transaction to Sui, and returns a settlement receipt.

**Open source, Apache 2.0.** The source is fully auditable. You can self-host it, fork it, or contribute to it. SweeFi also runs a **managed facilitator** as a hosted service — `@sweefi/sui` and `@sweefi/server` point at it by default, so most integrators get working settlement without any deployment. Override `facilitatorUrl` in `createS402Client` (`@sweefi/sui`) or `s402Gate` (`@sweefi/server`) to use your own instance.

This package is **not published to npm** — it's a service you deploy, not a library you import. Clone the repo, configure environment variables, and run it locally, in Docker, or on Fly.io. Resource servers point their `s402` payment requirements at the URL you deploy.

Supported payment schemes: `exact`, `prepaid`, `stream`, `escrow`.

---

## How it fits: the sign-first model

```
Client
  │
  │  1. Resource server returns HTTP 402 with payment requirements
  │     (amount, payTo address, scheme, network)
  │
  │  2. Client builds + signs a Sui PTB locally
  │     (private key never leaves the client)
  │
  │  3. Client POSTs the signed payload to the facilitator
  │
  ▼
Facilitator  ←── this service
  │
  │  4. Verifies: signature validity, amount correctness,
  │     payTo address match, scheme rules
  │
  │  5. Broadcasts the transaction to Sui
  │
  ▼
Sui Network
  │
  │  6. Move contract executes: transfers funds, emits event,
  │     enforces fee split at the contract level
  │
  ▼
Resource Server
  │
  │  7. Client presents tx digest as proof of payment
  │     Resource server verifies on-chain and unlocks content
```

Why sign-first? The client's private key never travels over the network. The facilitator cannot redirect funds — it can only broadcast a transaction the client already constructed and signed. Move's balance conservation rules enforce the fee split on-chain; the facilitator cannot manipulate what the contract does.

---

## Quickstart

### Prerequisites

- Node.js 22+
- pnpm (workspace setup — this package lives inside the `sweefi` monorepo)

### Local development

```bash
# From the monorepo root, install all workspace deps
pnpm install

# Copy the example env file
cp packages/facilitator/.env.example packages/facilitator/.env

# Edit .env with your API keys (see Environment Variables below)

# Start with hot reload
pnpm --filter @sweefi/facilitator dev
```

The server starts on `http://localhost:4022` by default.

### Docker build

```bash
cd packages/facilitator

# Build the image
docker build -t sweefi-facilitator .

# Run it
docker run -p 4022:4022 \
  -e API_KEYS="your-secret-key" \
  -e FEE_BPS="50" \
  sweefi-facilitator
```

The Dockerfile uses a multi-stage build: deps → build → slim runtime image. The final image runs `node dist/index.mjs` on port 4022.

### Fly.io deploy

The included `fly.toml` is pre-configured for a `shared-cpu-1x` 256 MB machine in `sjc`. It auto-stops when idle and auto-starts on incoming requests.

```bash
# One-time setup
fly launch --no-deploy

# Set secrets (never commit these)
fly secrets set API_KEYS="your-secret-key-1,your-secret-key-2"
fly secrets set FEE_BPS="50"

# Optional: custom RPC
fly secrets set SUI_MAINNET_RPC="https://your-rpc-provider.example.com"

# Deploy
fly deploy
```

After deployment your facilitator URL will be something like `https://swee-facilitator.fly.dev`. Point your s402 resource server's `facilitatorUrl` config at that address.

---

## Environment variables

Validated at startup with Zod. The server will refuse to start if required variables are missing or malformed.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEYS` | Yes | — | Comma-separated list of bearer token API keys. Clients must present one of these in the `Authorization` header. **Each key must be ≥ 16 characters** — shorter keys are rejected at startup. Generate with `openssl rand -hex 32`. |
| `PORT` | No | `4022` | Port to listen on. |
| `FEE_BPS` | No | `50` | Protocol fee in basis points (50 = 0.5%). Included in the `/.well-known/s402.json` discovery document and passed to scheme handlers for PTB construction. |
| `FACILITATOR_KEYPAIR` | No | — | Base64-encoded Ed25519 keypair for gas sponsorship (reserved for future use). |
| `SUI_MAINNET_RPC` | No | Mysten default | Custom RPC URL for `sui:mainnet`. Use this to point at a dedicated node or RPC provider. |
| `SUI_TESTNET_RPC` | No | Mysten default | Custom RPC URL for `sui:testnet`. |
| `SWEEFI_PACKAGE_ID` | No | — | SweeFi Move package ID. When set, scheme handlers verify that on-chain events originate from this package, preventing spoofed events from attacker-deployed contracts. |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, or `error`. |

---

## API endpoints

All endpoints except `/health` and `/.well-known/s402.json` require an `Authorization: Bearer <key>` header.

Request bodies are capped at 256 KB. The server returns `429` if a client exceeds the rate limit (token bucket: 100 requests max, refills at 10 per second, keyed per API key).

---

### `GET /health`

Liveness check. No authentication required.

**Response**

```json
{ "status": "ok", "timestamp": "2026-02-16T00:00:00.000Z" }
```

---

### `GET /.well-known/s402-facilitator`

Facilitator identity document. Returns a signed fee schedule describing who this facilitator is, what it charges, and the networks and schemes it supports. No authentication required.

**Response**

```json
{
  "version": "1",
  "feeBps": 50,
  "feeRecipient": "0xabc...",
  "minFeeUsd": "0.001",
  "supportedSchemes": ["exact", "prepaid", "stream", "escrow"],
  "supportedNetworks": ["sui:testnet", "sui:mainnet"],
  "validUntil": "2026-03-23T00:00:00.000Z"
}
```

`validUntil` is a rolling 30-day window updated at each deploy. The `feeRecipient` field is `null` if `FACILITATOR_FEE_RECIPIENT` is not configured.

> **Note on signatures:** The `signature` field is reserved for a future release. Once `FACILITATOR_KEYPAIR` is configured, this payload will be signed over canonical JSON so clients can cryptographically verify the fee schedule before trusting it.

**Difference from `/.well-known/s402.json`:** `/.well-known/s402.json` describes the resource server (who charges). `/.well-known/s402-facilitator` describes the facilitator (who settles). These are two distinct actors in the s402 protocol — a single deployment may run both, but conceptually they serve different roles.

---

### `GET /.well-known/s402.json`

Discovery document. Clients and resource servers can query this to learn what schemes and networks this facilitator supports, and what fee rate it charges. No authentication required.

**Response**

```json
{
  "s402Version": "0.1.0",
  "schemes": ["exact", "prepaid", "stream", "escrow"],
  "networks": ["sui:testnet", "sui:mainnet"],
  "assets": [],
  "directSettlement": true,
  "mandateSupport": false,
  "protocolFeeBps": 50
}
```

---

### `GET /supported`

Lists supported networks and their available schemes. Authentication required.

**Response**

```json
{
  "s402Version": "0.1.0",
  "networks": {
    "sui:testnet": ["exact", "prepaid", "stream", "escrow"],
    "sui:mainnet": ["exact", "prepaid", "stream", "escrow"]
  }
}
```

---

### `POST /verify`

Verifies a signed payment payload against requirements without broadcasting to Sui. Use this to pre-check a payment before committing.

**Request body**

```json
{
  "paymentPayload": {
    "scheme": "exact",
    "payload": {
      "transaction": "<base64-encoded Sui PTB bytes>",
      "signature": "<base64-encoded signature>"
    }
  },
  "paymentRequirements": {
    "network": "sui:testnet",
    "amount": "1000000000",
    "payTo": "0xb0b..."
  }
}
```

**Response** — shape depends on the scheme implementation, but always includes a `success` boolean and an optional `error` field on failure.

---

### `POST /settle`

Verifies and broadcasts the transaction to Sui. This is the primary settlement endpoint.

Same request body shape as `/verify`. On success, returns the Sui transaction digest and settlement details. The facilitator records the settlement in its usage tracker keyed by API key.

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | Missing or invalid fields in the request body |
| `401` | Missing or malformed `Authorization` header |
| `403` | Invalid API key |
| `429` | Rate limit exceeded |
| `500` | Sui RPC error or scheme-level failure |

---

### `POST /s402/process`

Atomic verify + settle in a single call. Equivalent to calling `/verify` then `/settle`, but the facilitator does both in one round trip. Preferred for production use — fewer network hops, and the verification and broadcast are coupled so a successful verify cannot race with a concurrent settle.

Same request body and response shape as `/settle`.

---

## Security

### API key authentication

All settlement endpoints are protected by bearer token authentication. The middleware uses constant-time comparison (SHA-256 hash both sides, then `crypto.timingSafeEqual`) to prevent timing side-channel attacks. It also iterates all valid keys without short-circuiting, so key position and set size are not leaked via response time.

**Minimum key entropy:** Each key in `API_KEYS` must be at least 16 characters. The server refuses to start with shorter keys — they are trivially brute-forceable. The recommendation is 32+ hex characters from a CSPRNG:

```bash
openssl rand -hex 32
```

Rotate keys by updating `API_KEYS` and redeploying. The comma-separated format lets you do zero-downtime rotation by temporarily including both the old and new key.

### Rate limiting

Token bucket limiter keyed by API key (100 requests max, refills at 10/sec). For authenticated requests the API key is used as the bucket identifier, which is not spoofable. For unauthenticated routes (health, discovery), the limiter falls back to `x-forwarded-for` / `x-real-ip` headers — reliable behind a trusted reverse proxy (Cloudflare, nginx, Fly.io's proxy) but trivially spoofable if the service is directly exposed to the internet without a proxy in front.

### Package ID anti-spoofing

Set `SWEEFI_PACKAGE_ID` in production. Without it, scheme handlers that verify on-chain events cannot confirm those events came from the legitimate SweeFi Move package. An attacker could deploy a contract that emits structurally identical events and fool a facilitator that does not check the originating package. With the package ID set, the scheme handlers reject events from any other contract address.

**Warning at startup:** If `SWEEFI_PACKAGE_ID` is not set, the facilitator logs a prominent warning on startup explaining that event anti-spoofing is disabled. This is intentional — the variable is optional for local development but should always be set before handling real payments on mainnet.

### Body size limit

All requests are capped at 256 KB. Oversized payloads are rejected before any parsing occurs.

### Trust boundary

Unknown fields in `paymentRequirements` are stripped at the route layer (`pickRequirementsFields` from `s402/http`) before being passed to scheme handlers. This prevents injection of unexpected fields that could influence downstream Move PTB construction.

### Fee enforcement

The facilitator does not independently verify that `protocolFeeBps` in the payment requirements matches what the Sui PTB actually collects. This is intentional: each scheme's `settle` handler builds the PTB with the fee split baked in, and Sui's execution enforces balance conservation. A dishonest resource server cannot reduce fees by lying about `protocolFeeBps` in the requirements, because the facilitator — not the resource server — controls PTB construction. Operators deploying custom scheme implementations must ensure their Move contracts enforce fee collection.

---

## Architecture

```
packages/facilitator/
├── src/
│   ├── index.ts              # Server bootstrap — loads config, wires Hono, starts listening
│   ├── app.ts                # createApp() — middleware stack and route mounting
│   ├── config.ts             # Zod-validated environment config
│   ├── facilitator.ts        # createFacilitator() — registers Sui scheme handlers
│   ├── routes.ts             # HTTP route handlers (verify, settle, s402/process, supported)
│   ├── auth/
│   │   └── api-key.ts        # Constant-time bearer token auth middleware
│   ├── middleware/
│   │   ├── rate-limiter.ts   # Token bucket rate limiter per API key
│   │   └── logger.ts         # Request logging middleware
│   └── metering/
│       ├── usage-tracker.ts  # In-memory settlement tracking (Phase 1)
│       ├── hooks.ts          # recordSettlement() — called after successful settle
│       ├── fee-calculator.ts # Fee math utilities
│       └── metrics.ts        # IMetrics interface + NoopMetrics (seam for Prometheus/OTEL)
├── Dockerfile                # Multi-stage build: deps → build → slim runtime
└── fly.toml                  # Fly.io config (shared-cpu-1x, 256mb, sjc, auto-stop)
```

**Middleware execution order** (from `app.ts`):

1. `bodyLimit` — rejects oversized requests before any parsing
2. `requestLogger` — structured request/response logging
3. `apiKeyAuth` — validates bearer token for protected routes
4. `meteringContext` — propagates API key for inline settlement recording
5. `rateLimiter` — token bucket, keyed by API key or IP fallback

**Scheme registration** (`facilitator.ts`): The `s402Facilitator` from the `s402` package manages a registry of scheme implementations per network. At startup, `ExactSuiFacilitatorScheme`, `PrepaidSuiFacilitatorScheme`, `StreamSuiFacilitatorScheme`, and `EscrowSuiFacilitatorScheme` are registered for both `sui:testnet` and `sui:mainnet`. Each scheme knows how to verify a signed PTB and broadcast it to the appropriate Sui RPC endpoint.

**Metering — Phase 1**: Successful settlements are recorded in memory keyed by API key (`UsageTracker`). This is a Phase 1 design — the `IUsageTracker` interface makes it straightforward to swap in a persistent backend (Redis, Postgres, or an on-chain contract) without touching the route handlers.

**Observability seam**: The `IMetrics` interface in `metering/metrics.ts` defaults to `NoopMetrics` (zero overhead). Pass a `PrometheusMetrics` or `OtelMetrics` implementation to `createApp()` when you need instrumentation.

**Testability**: `app.ts` exports `createApp(config)` separately from `index.ts` so the application can be constructed in tests without starting a real server. Integration tests can pass a custom config and call `app.fetch` directly.

---

## Running tests

```bash
# Unit tests
pnpm --filter @sweefi/facilitator test

# Integration tests (requires Sui testnet RPC access)
pnpm --filter @sweefi/facilitator test:integration

# Type check only
pnpm --filter @sweefi/facilitator typecheck
```

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).

Source: [github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
