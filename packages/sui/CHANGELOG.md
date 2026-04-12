# Changelog

All notable changes to `@sweefi/sui` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.6] - 2026-04-11

### Fixed
- **CRITICAL: Fee bypass attack on stream/prepaid facilitators (DAN-279).** Added `fee_micro_pct` to `StreamCreated` and `PrepaidDeposited` Move events (4 emit sites). Stream and prepaid TypeScript facilitators now verify the emitted fee matches `bpsToMicroPercent(requirements.protocolFeeBps)`, matching escrow's existing pattern. A malicious client can no longer set `fee_micro_pct` to 0 in the PTB to skip protocol fees. Requires testnet redeployment for live enforcement.
- **`_pendingMemo` race condition under concurrent fetches (DAN-281).** Removed mutable shared state (`_pendingMemo` property on singleton scheme). Memo is now threaded through `requirements.extensions.memo` — each concurrent `s402Fetch()` gets its own requirements object with no shared mutable state.

### Changed
- 4 new fee verification unit tests (stream + prepaid: bypass rejection, fee=0 acceptance)
- Memo tests updated from `_pendingMemo` to `requirements.extensions.memo` pattern
- **680 tests passing** (was 662 in 0.2.5)

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
