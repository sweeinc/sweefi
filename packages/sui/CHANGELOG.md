# Changelog

All notable changes to `@sweefi/sui` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] - 2026-03-10

### Fixed
- **CRITICAL**: `buildCreateMandateTx` and `buildCreateAgentMandateTx` serialized `expiresAtMs` as raw `u64` but Move expects `Option<u64>`. Now uses `tx.pure.option("u64", ...)` with nullable TS type (`bigint | null`). Previously caused BCS deserialization failure when calling with a non-null expiry.
- `buildMandatedPayTx` and `buildAgentMandatedPayTx` now validate `amount > 0` via `assertPositive` (previously accepted zero/negative amounts silently)
- `buildPayInvoiceTx` now validates `amount > 0` via `assertPositive`
- `buildTopUpTx` (stream) now validates `depositAmount > 0` via `assertPositive`
- `buildTopUpTx` (prepaid) now validates `amount > 0` via `assertPositive`
- `ExactSuiClientScheme.createPayment` now rejects zero/negative payment amounts with a clear error

## [0.2.4] - 2026-03-08

### Changed
- Sync admin PTB builders with auto-unpause contract changes (v11 testnet deploy)

## [0.2.3] - 2026-03-07

### Added
- s402 client memo passthrough for on-chain payment receipts
- Payment metadata on s402 Response (non-enumerable property)
