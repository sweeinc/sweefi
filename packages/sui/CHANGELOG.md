# Changelog

All notable changes to `@sweefi/sui` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-12

### Added

- **Upto scheme — full TypeScript adapter stack (DAN-284).** Variable-amount payments where the client deposits maxAmount and the facilitator settles the actual usage:
  - `UptoSuiClientScheme` — builds deposit PTB, auto-computes `settlementCeiling` from `estimatedAmount` (1.2x headroom)
  - `UptoSuiFacilitatorScheme` — event-based verification (anti-spoofing, token/payer/recipient/amount/deadline/fee checks), populates `actualAmount` and `depositId` on settle response
  - `UptoSuiServerScheme` — builds requirements from route config with `estimatedAmount` advisory
  - `UptoContract` — curried transaction builder (create/settle/expire) following EscrowContract pattern
  - PTB builders: `buildCreateUptoDepositTx`, `buildSettleUptoTx`, `buildExpireUptoTx`
  - `UptoDepositBcs` — BCS type definition for on-chain UptoDeposit parsing
  - `UptoQueries` + `UptoDepositState` — query module for reading deposit state
  - 34 new unit tests covering all facilitator security checks and server requirements
- **`EXTENSION_FAILED` error code** added to `SweefiErrorCode` enum, matching s402 v0.5.0.

### Changed

- **`skipVerify` option threaded through all facilitator schemes.** `settle()` on ExactSuiFacilitatorScheme, StreamSuiFacilitatorScheme, EscrowSuiFacilitatorScheme, PrepaidSuiFacilitatorScheme, and UptoSuiFacilitatorScheme now accepts an optional `{ skipVerify?: boolean }` third parameter. When true, skips the defense-in-depth re-verify dry-run — safe on Sui where failed PTBs cost zero gas.
- **Extension access migrated to typed helpers.** `ExactSuiClientScheme` now uses `getExtensionData<T>()` from s402 instead of raw `requirements.extensions?.memo as string` dict access. Wire format unchanged.
- **Escrow/Unlock clients now require explicit arbiter.** `EscrowSuiClientScheme` and `UnlockSuiClientScheme` throw if `escrow.arbiter` is not specified (was: silent default to seller). The Move contract rejects `arbiter == seller` (`EArbiterIsSeller`), so the old default always failed on-chain.

### Fixed

- **Settlement ceiling verification (free-service attack).** `UptoSuiFacilitatorScheme.verify()` now checks that `settlement_ceiling` (if >0) is >= `estimatedAmount` (or `maxAmount` when no estimate). Without this, a malicious client could set `ceiling=1`, pass all other checks, then the on-chain `settle()` always aborts — deposit expires with a full refund, free service. Defense lives in the facilitator (chain-specific), not the s402 spec (chain-agnostic).
- **733 tests passing** (was 687 in 0.3.x). 46 new tests (upto scheme + ceiling verification + arbiter enforcement).

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
