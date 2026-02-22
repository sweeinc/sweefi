# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `GET /ready` — Readiness probe. Distinct from `/health` (liveness): checks both scheme
  registration and Sui RPC connectivity via a lightweight JSON-RPC call with 3s timeout.
  Returns 503 if either check fails. No auth required.

- `GET /settlements` — Per-key settlement history. Returns records for the authenticated
  API key since last restart, with pagination (`?limit=100&offset=0`, max 1000). Response
  includes `dataRetainedSince` (server start time) to signal the in-memory retention window.
  Auth required. See ADR-008 for decisions on scope (per-key only, not fleet-wide).

- `src/middleware/dedup.ts` — Payload dedup middleware applied to `/settle` and
  `/s402/process`. Solves the network-timeout reliability problem: if the HTTP response is
  lost after a successful Sui broadcast, the client retries and receives the cached success
  response with `X-Idempotent-Replay: true` instead of a 500. Dedup key includes the API
  key to prevent cross-tenant cache collisions. TTL: 60s. In-memory only (Phase 1).
  See ADR-008 for full decision log and rejected alternatives.

---

## [0.1.0] — Initial release

### Added

- Hono-based HTTP server on port 4022
- Endpoints: `GET /health`, `GET /supported`, `POST /verify`, `POST /settle`,
  `POST /s402/process`, `GET /.well-known/s402-facilitator`, `GET /.well-known/s402.json`
- Middleware: bodyLimit (256 KB), requestLogger, apiKeyAuth (constant-time comparison),
  meteringContext, RateLimiter (token bucket, 100 max / 10 per second)
- Scheme registry: ExactSui, PrepaidSui, StreamSui, EscrowSui — testnet + mainnet
- In-memory UsageTracker (Phase 1), IMetrics seam with NoopMetrics
- Zod-validated environment config with startup rejection on invalid values
- Docker + Fly.io deploy targets
