# Changelog

All notable changes to `@sweefi/cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (v0.3 review)
- Idempotent receipt hit now includes `txDigest` (populated via `showPreviousTransaction`)
- Idempotency key matching uses exact segment comparison (prevents substring collisions with short keys)
- pay-402 paid-fetch timeout/failure marked `retryable: false` (TX may already be on-chain)
- `printHuman` flattens nested objects with dot notation (fixes `[object Object]` display)
- `_pendingMemo` cleared on s402 scheme dispatch failure (prevents cross-fetch memo leak)
- Warning emitted when memo provided without `packageId` in `@sweefi/sui` client

### Fixed (v0.4 R1 — schema integrity + output contract)
- PAYMENT_FAILED error code in schema corrected to `retryable: false` (matches code behavior)
- `pay` command idempotent hit now includes `txDigest` (same fix as pay-402)

### Fixed (v0.4 R2 — adversarial audit)
- `parseAmount` rejects hex literals (`0xFF`) that JavaScript's `Number()` silently parses as decimal
- `parseDuration` guards against `Infinity` overflow before `BigInt()` conversion (prevents RangeError crash)
- `sanitize()` base64 detection threshold lowered from 60 to 40 chars (covers Ed25519 44-char keys)
- Error handler now tracks `_command` and `_reqCtx` module-level state for correct error envelope context

### Added
- pay-402 `--dry-run` returns 402 requirements without executing payment
- `dry-run` flag in pay-402 schema manifest
- 41 schema integrity tests (CI-enforced cross-reference of schema vs actual command behavior)
- 22 adversarial input tests (hex parsing, duration overflow, key redaction, error handler integration)
- Full error path + happy path coverage for mandate create, prepaid deposit, pay, pay-402

## [0.3.0] - 2026-03-07

### Added
- **pay-402 idempotency** via `--idempotency-key` — same crash-safe dedup as `pay`
- **Payment metadata** in pay-402 output — `txDigest`, `receiptId`, `gasCostSui` in nested `payment` object
- `--idempotency-key` required in JSON mode for `pay-402` (prevents silent double-spend)
- Auto-generated idempotency key for `pay-402` in `--human` mode
- CHANGELOG.md

### Changed
- pay-402 output field `status` renamed to `httpStatus` (avoids ambiguity with tx status)

### Fixed
- pay-402 routing now receives `idempotencyKey` and `dryRun` flags (previously only `pay` received these)

## [0.2.0] - 2026-03-07

### Added
- Idempotent payments via `--idempotency-key` for `pay` command
- `meta` block in every JSON response (network, timing, gas, requestId)
- `sweefi schema` command — machine-readable manifest with commands, globalFlags, envVars, errorCodes
- `sweefi doctor` — setup diagnostics
- `--verbose` stderr debug logging
- `--timeout <ms>` global RPC timeout (default: 30000)
- Enhanced `--dry-run` with dual-balance affordability checks
- 12 Move abort code mappings (mandate + prepaid errors)
- TX failure sub-codes: TX_OUT_OF_GAS, TX_OBJECT_CONFLICT, TX_EXECUTION_ERROR
- `retryAfterMs` on retryable error envelopes
- `requiresHumanAction` flag on mandate/revocation errors

### Changed
- `--idempotency-key` required in JSON mode for `pay` (prevents silent double-spend)

## [0.1.0] - 2026-02-28

### Added
- Initial release
- Commands: pay, pay-402, balance, receipt, prepaid (deposit/status/list), mandate (create/check/list), wallet generate
- JSON-first output with `--human` mode
- Env-var-only configuration
