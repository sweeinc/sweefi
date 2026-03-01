# SweeFi V8 — Post-Fix Full Audit Report

> **Purpose**: Independent post-fix validation. Verifies all 14 fixes from V8-FINAL-AUDIT.md,
> checks for regressions, and performs a fresh 6-persona audit for missed issues.
>
> **Date**: 2026-02-28
> **Auditor**: Claude Opus 4.6 (fresh session, no anchoring from fix session)
> **Scope**: 10 Move modules, 10 TypeScript packages, facilitator infra, documentation
> **Prior Report**: docs/V8-FINAL-AUDIT.md (14 findings, all claimed fixed)
> **Original Verdict**: CONDITIONAL SHIP — 2 regressions found, 1 new finding
> **Updated Verdict (2026-02-28)**: SHIP — All 3 post-fix findings resolved. See resolution notes below.

---

## Part 1: Fix Verification (14 of 14)

### BLOCKs

#### F-02: Root re-export removal — ✅ FIXED (NEW-01 resolved)

**Claimed fix**: Removed `adaptWallet` from root re-export in `packages/server/src/index.ts`.

**What was done**: Line 23-26 now has a comment explaining `adaptWallet` is intentionally
NOT re-exported, and the named export was removed. ✅

**But the fix is incomplete**: Line 27 still does:
```typescript
export { wrapFetchWithS402, s402PaymentSentError } from "./client/index";
```
This ESM re-export loads `./client/index.ts`, which loads `./wallet-adapter.ts` (line 4:
`export { adaptWallet } from "./wallet-adapter"`), which imports `@sweefi/sui` (line 3:
`import { toClientSuiSigner } from "@sweefi/sui"`). ESM evaluates ALL module-level
imports when loading a module — even exports the consumer didn't import.

**Result**: `import { s402Gate } from '@sweefi/server'` still crashes with MODULE_NOT_FOUND
for npm consumers without `@sweefi/sui`. See NEW-01 for full analysis and fix.

---

#### F-03: `/ready` 10s TTL cache — ✅ VERIFIED

`app.ts:81-113` implements the cache correctly:
- `readyCache` variable with `{ result, ready, expiresAt }` shape
- Cache checked before RPC calls (`readyCache.expiresAt > now`)
- 10-second TTL at line 112: `expiresAt: now + 10_000`
- Security comment at line 77-79 explains the rationale

**Regression risk #2 (race condition)**: Two simultaneous requests when cache is expired
both execute RPC calls and both set cache. This is "last-writer-wins" — both get correct
results, at most doubling RPC calls for one interval. **Acceptable. No regression.**

---

### HIGHs

#### F-04: Exact scheme documented as fee-free — ✅ VERIFIED

- `exact/client.ts:1-20`: Detailed header comment explaining fee-free design for v0.1
- `routes.ts:62-72`: Corrected documentation block explaining fee enforcement per scheme
- `SPEC.md:490`: "Exact scheme: Fees are currently non-functional (both splits go to `payTo`)"

---

#### F-05: `resolveCoinType()` network param — ✅ VERIFIED

`format.ts:270-280`:
```typescript
export function resolveCoinType(input?: string, network?: string): string {
  // ...
  if (upper === "USDC") {
    const isTestnet = network?.includes("testnet") ?? false;
    return isTestnet ? TESTNET_COIN_TYPES.USDC : COIN_TYPES.USDC;
  }
```

**All callers updated** — grep confirms every call site in MCP tools passes `ctx.network`:
- `tools/pay.ts:40`, `tools/balance.ts:23`, `tools/invoice.ts:86`
- `tools/stream.ts:44,120,179,222`, `tools/escrow.ts:52,121,177,226`
- `tools/prepaid.ts:57,131,182,229,277,334,479`, `tools/prove.ts:45`
- `tools/mandate.ts:95,174,254,335,404`

Tests at `format.test.ts:54-57` cover testnet resolution for both `"testnet"` and
`"sui:testnet"` formats.

**CLI's `parse.ts:16`** has its own copy of `resolveCoinType` with `network` param
defaulting to `"testnet"`. CLI context type-constrains network to `"testnet" | "mainnet" |
"devnet"` (no CAIP-2 prefix), so the strict equality `=== "mainnet"` is correct for CLI.

**Regression risk #3**: No missed callers. ✅

---

#### F-06: `fly.toml` health check to `/ready` — ✅ VERIFIED

`fly.toml:20-28`:
```toml
[[http_service.checks]]
  interval = "15s"
  timeout = "5s"
  grace_period = "15s"    # increased from 10s
  method = "GET"
  path = "/ready"         # changed from /health
```

Comment at lines 20-22 explains the rationale.

---

### MEDIUMs

#### F-10: SPEC.md fee floor — ✅ VERIFIED

SPEC.md line 488:
> $0.01 advisory minimum — the facilitator MAY reject settlements below this floor
> off-chain, but the Move contracts do not enforce a minimum fee on-chain.
> `calculate_fee_min()` exists in `math.move` but is not wired into production
> modules (V8 audit F-10).

---

#### F-11: Facilitator removed from publish — ✅ VERIFIED

- `packages/facilitator/package.json`: `"private": true` ✅. No `publishConfig` or
  `files` fields (cleaned up). ✅
- `TESTNET-DEPLOY-RUNBOOK.md:304,369`: Notes say `@sweefi/facilitator` is NOT published.
  No `pnpm --filter @sweefi/facilitator publish` commands remain. ✅

---

#### F-13: Mainnet packageId guard — ⚠️ REGRESSION (see NEW-02)

**Claimed fix**: Added `network` param to constructors, throws on mainnet without packageId.

**What was done**: All three constructors have the guard:
```typescript
if (!packageId && network?.includes("mainnet")) {
  throw new Error("...packageId is required on mainnet...");
}
```
- `stream/facilitator.ts:56-61` ✅
- `escrow/facilitator.ts:56-61` ✅
- `prepaid/facilitator.ts:52-57` ✅

**But the guard is never triggered**: `facilitator.ts:42-46`:
```typescript
for (const network of networks) {
    facilitator.register(network, new PrepaidSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new StreamSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new EscrowSuiFacilitatorScheme(signer, packageId));
}
```

The `network` variable exists in the loop scope but is **never passed as the 3rd constructor
argument**. All three constructors receive `(signer, packageId)` — `network` defaults to
`undefined`, so `network?.includes("mainnet")` is always `false`.

**Result**: The mainnet guard is dead code. A facilitator deployed to mainnet without
`SWEEFI_PACKAGE_ID` would start normally with suffix-matching event extraction. See NEW-02.

---

#### F-15: `kill_signal` and `kill_timeout` — ✅ VERIFIED

`fly.toml:30-34`:
```toml
# V8 audit F-15: ...
kill_signal = "SIGTERM"
kill_timeout = 15
```

Matches `index.ts:15` shutdown drain of 10 seconds (15 > 10). ✅

---

### LOWs

#### F-01: `@sweefi/server` moved to peerDependencies — ✅ VERIFIED

`packages/sui/package.json:60-63`:
```json
"peerDependencies": {
    "@mysten/sui": "^2.0.0",
    "@sweefi/server": ">=0.1.0"
}
```

No longer in `dependencies`. **Regression risk #4**: Workspace protocol handles peer dep
resolution for local development (`pnpm install` links workspace packages). ✅

---

#### F-14: Mandate doc comments — ✅ VERIFIED

`mandate.move:157-158`:
```move
// Lifetime cap (unconditional — 0 means zero budget, NOT unlimited.
// This differs from AgentMandate where 0 = unlimited. See V8 audit F-14.)
```

---

#### F-16: `.dockerignore` — ✅ VERIFIED

`.dockerignore` at monorepo root with sensible exclusions:
```
.git, node_modules, contracts, docs, *.md, !README.md, .env*, .vscode, .idea, coverage, *.tgz
```

---

#### F-17: Dust guard — ✅ VERIFIED

`exact/client.ts:48-53`:
```typescript
// V8 audit F-17: Skip the fee split when feeAmount rounds to zero.
if (feeAmount === 0n) {
    const coin = coinWithBalance({ type: asset, balance: totalAmount });
    tx.transferObjects([coin], payTo);
}
```

**Regression risk #6**: When `feeAmount === 0n` AND `protocolFeeBps > 0` (fee rounds to
zero on tiny amounts), `totalAmount` (= `BigInt(amount)`) goes entirely to `payTo`. This
is correct — no fee was earned, merchant gets the full required amount. ✅

---

#### F-18: Description update — ✅ VERIFIED

`packages/server/package.json:5`:
```json
"description": "s402 server middleware (chain-agnostic) and Sui client fetch wrapper for Hono and Node.js"
```

Clearly indicates both the chain-agnostic and Sui-specific parts. ✅

---

## Part 2: Regression Findings

### [HIGH] NEW-01: F-02 fix incomplete — root barrel still loads `@sweefi/sui` — **FIXED**

**Files**: `packages/server/src/index.ts:27`, `packages/server/src/client/index.ts:4`,
`packages/server/src/client/wallet-adapter.ts:3`, `packages/server/tsdown.config.ts:5`

**Description**: The F-02 fix removed `adaptWallet` from the root barrel's named exports
but did NOT break the ESM module load chain. The root barrel still re-exports from
`./client/index`:

```
import { s402Gate } from '@sweefi/server'          (consumer code)
  → dist/index.mjs
    → export { wrapFetchWithS402 } from "./client/index.mjs"   [src/index.ts:27]
      → client/index.mjs evaluates ALL top-level exports:
        → export { adaptWallet } from "./wallet-adapter"        [client/index.ts:4]
          → import { toClientSuiSigner } from "@sweefi/sui"     [wallet-adapter.ts:3]
            → MODULE_NOT_FOUND ❌ (unless consumer installed @sweefi/sui)
```

`tsdown.config.ts` confirms `client/index` is a separate entry point, so the bundler
creates `dist/client/index.mjs` as a separate file. The root `dist/index.mjs` references
it via ESM import — full evaluation occurs.

**Impact**: Same as original F-02 — default import path broken for npm consumers who only
want `s402Gate`. First-time users hit MODULE_NOT_FOUND.

**Root cause**: `wrapFetchWithS402` is re-exported from `./client/index` (which also
exports `adaptWallet`). The two exports share a barrel. ESM loads the entire barrel.

**Fix**: Change root barrel to import `wrapFetchWithS402` directly from `./client/s402-fetch`
instead of from `./client/index`:

```typescript
// packages/server/src/index.ts line 27 — CURRENT (broken):
export { wrapFetchWithS402, s402PaymentSentError } from "./client/index";

// FIXED:
export { wrapFetchWithS402, s402PaymentSentError } from "./client/s402-fetch";
export type { s402FetchOptions } from "./client/s402-fetch";
```

`s402-fetch.ts` only imports from `s402` (declared dep) — no Sui dependencies. This
breaks the chain. The `./client` subpath export continues to work normally for consumers
who want `adaptWallet` (they explicitly opted in to the Sui dependency).

**Secondary impact**: `packages/sui/src/client/s402-client.ts:22` imports
`DEFAULT_FACILITATOR_URL` from `@sweefi/server` (root). This creates a circular dependency
chain: `@sweefi/sui → @sweefi/server → ./client/index → ./wallet-adapter → @sweefi/sui`.
ESM handles cycles via partial bindings, but this is fragile. Consider either:
- Adding a `@sweefi/server/constants` subpath export for `DEFAULT_FACILITATOR_URL`
- Or inlining the constant in `@sweefi/sui`

**Verify**: Read `index.ts:27`, `client/index.ts:4`, `wallet-adapter.ts:3`, `s402-fetch.ts`
(confirm s402-fetch has no Sui imports).

---

### [HIGH] NEW-02: F-13 fix dead code — facilitator doesn't pass `network` to constructors — **FIXED**

**File**: `packages/facilitator/src/facilitator.ts:42-46`

**Description**: The F-13 fix added mainnet guards to the scheme constructors:
```typescript
constructor(signer, packageId?, network?) {
    if (!packageId && network?.includes("mainnet")) { throw ... }
}
```

But the actual registration code doesn't pass `network`:
```typescript
for (const network of networks) {   // ← 'network' exists here
    facilitator.register(network, new PrepaidSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new StreamSuiFacilitatorScheme(signer, packageId));
    facilitator.register(network, new EscrowSuiFacilitatorScheme(signer, packageId));
    //                                                         ↑ missing: , network
}
```

The `network` loop variable is RIGHT THERE but never passed to the constructors. The guard
is dead code.

**Impact**: A facilitator deployed to mainnet without `SWEEFI_PACKAGE_ID` starts
successfully with suffix-matching event extraction. An attacker can deploy a contract that
emits fake `StreamCreated`/`EscrowCreated`/`PrepaidDeposited` events to bypass verification.

**Fix**: Pass `network` as the 3rd argument:
```typescript
for (const network of networks) {
    facilitator.register(network, new ExactSuiFacilitatorScheme(signer));
    facilitator.register(network, new PrepaidSuiFacilitatorScheme(signer, packageId, network));
    facilitator.register(network, new StreamSuiFacilitatorScheme(signer, packageId, network));
    facilitator.register(network, new EscrowSuiFacilitatorScheme(signer, packageId, network));
}
```

**Verify**: Read `facilitator.ts:42-46`. Count constructor arguments — all three have 2
args (signer, packageId), should have 3 (signer, packageId, network).

---

## Part 3: Fresh 6-Persona Audit

### Persona 1: Move Security Auditor

**Scope**: All 10 Move modules, ~3,583 lines.

No new findings. The prior audit (Wave 1) was thorough. Key security properties verified:
- u128 intermediate math in all fee calculations ✅
- Registry ownership check before `is_id_revoked()` ✅
- `remaining()` saturation guard ✅
- `ETimeoutTooLong` / `ETimeoutTooShort` distinct error codes ✅
- All exits (close, refund, withdraw, recipient_close) are unpausable ✅
- `seal_approve` has no `ctx.sender()` check (bearer model) ✅

---

### Persona 2: Protocol Economist

**Scope**: Fee model, economic incentives, attack surfaces.

#### [MEDIUM] NEW-03: Fee unit mismatch between TS SDK and Move contracts — **FIXED**

**Files**: `packages/sui/src/ptb/assert.ts:4`, `packages/sui/src/ptb/types.ts:42`,
`contracts/sources/math.move:31`, `packages/sui/src/s402/exact/client.ts:44`,
`packages/facilitator/src/config.ts:14`, `SPEC.md:487-488`

**Description**: The TS SDK and Move contracts use different fee denominators for the
same `feeBps` / `fee_bps` value:

| Layer | Field name | Denominator | `50` means |
|-------|-----------|-------------|-----------|
| TS SDK (types.ts:42) | `feeBps` | 10,000 (bps) | 0.5% |
| TS SDK (assert.ts:4) | `assertFeeBps()` | max: 10,000 | 100% |
| TS exact client (client.ts:44) | `protocolFeeBps` | `/10000n` | 0.5% |
| Move contracts (math.move:31) | `fee_bps` | 1,000,000 (micro-%) | 0.005% |
| Move contracts (stream.move:177) | validate | max: 1,000,000 | 100% |
| Facilitator config (config.ts:14) | `FEE_BPS` | max: 10,000 | — |
| SPEC.md:487 | — | — | "50 basis points (0.5%)" |

The PTB builders pass `feeBps` directly to Move as `tx.pure.u64(params.feeBps)` (e.g.,
`escrow.ts:89`, `stream.ts:44`, `prepaid.ts:80`). No conversion is applied.

**Consequence**: If the SPEC's "50 bps = 0.5%" claim is the intended fee rate:
- **Exact scheme** (TS-only): `50 / 10,000 = 0.5%` ✅ correct
- **Escrow/stream/prepaid** (Move): `50 / 1,000,000 = 0.005%` ❌ 100x lower

The escrow facilitator verification (`escrow/facilitator.ts:172-173`) checks
`escrowEvent.fee_bps == requirements.protocolFeeBps` — both are `50`, so it passes.
But the ON-CHAIN fee computation produces 100x less revenue than the SPEC claims.

**Impact**: No fund loss (fees are lower, not diverted). But:
1. Protocol revenue is 100x below SPEC projections
2. Grant reviewers see "50 bps" and calculate $X revenue — actual is $X/100
3. Fee parity between exact and Move-based schemes is broken

**Root cause**: Move's `math.move` was upgraded from traditional bps (÷10,000) to
micro-percent (÷1,000,000) for sub-bps precision. The TS SDK types, assert, SPEC, and
exact client were not updated to match.

**Fix options**:
- (a) **Update TS SDK**: Change `assertFeeBps` to allow 0-1,000,000, update all docs to
  say "micro-percent" not "bps", change `exact/client.ts:44` to divide by `1000000n`
- (b) **Keep TS as bps, convert at boundary**: In PTB builders, multiply `feeBps * 100`
  before passing to Move (converting bps → micro-percent). Update facilitator verification
  to expect `event.fee_bps = protocolFeeBps * 100`
- (c) **Document as intended**: If `50 / 1M = 0.005%` IS the actual desired fee, update
  SPEC.md and config comments to use micro-percent units

**Verify**: Read `math.move:31` (`FEE_DENOMINATOR: u128 = 1_000_000`). Read
`assert.ts:3-6` (`feeBps > 10_000`). Read `exact/client.ts:44` (`/ 10000n`). Trace
`escrow.ts:89` → Move `create()` → `math::calculate_fee()`.

---

### Persona 3: TypeScript SDK Architect

No additional findings beyond NEW-01. Package structure, subpath exports, CJS/ESM dual
format, and `prepublishOnly` gates are all correct.

The `tsdown.config.ts` correctly defines 3 entry points (`index`, `client/index`,
`server/index`), which is the right pattern for conditional tree-shakeable exports.

---

### Persona 4: DevOps Engineer

No additional findings beyond NEW-02. Verified:
- Dockerfile uses `pnpm deploy` pattern ✅ (prior fix #8)
- Graceful shutdown with SIGTERM/SIGINT + 10s timeout ✅ (prior fix #9)
- `fly.toml` health check, grace period, kill signal all correct ✅
- `.dockerignore` excludes large directories ✅
- Facilitator is `private: true`, not in publish sequence ✅
- Rate limiter is behind auth (lines 118-140 registration order) ✅

---

### Persona 5: Spec Compliance Auditor

SPEC.md is internally consistent with all V8 fixes applied. Fee floor documented as
advisory ✅. Exact scheme fee-free status documented ✅. Move error codes match source ✅.

**One concern (overlaps NEW-03)**: SPEC.md previously said "50 basis points (0.5%)" without
explaining the dual-unit system. **FIXED**: SPEC.md now documents the TS bps ↔ Move micro-percent
conversion and the `bpsToMicroPercent()` boundary function. See NEW-03 resolution notes.

---

### Persona 6: Adversarial Agent Operator

**Scenario tested**: Malicious MCP agent manipulating coin types, amounts, spending limits.

Verified defenses:
- `parseAmount()` rejects negative, zero, non-numeric, u64 overflow ✅
- `checkSpendingLimit()` blocks excessive per-tx and per-session amounts ✅
- `requireSigner()` throws clear error without `SUI_PRIVATE_KEY` ✅
- Abort code parser provides structured recovery guidance ✅
- MCP spending limits documented as best-effort (not security boundary) ✅
- Mandates documented as the real enforcement layer ✅

No new adversarial findings. The MCP security model is well-designed for the current
threat model (LLM misbehavior, not host compromise).

---

## Summary Table

| ID | Severity | Type | Title | File(s) | Status |
|----|----------|------|-------|---------|--------|
| **NEW-01** | **HIGH** | Regression | F-02 fix incomplete — root barrel loads @sweefi/sui | `server/src/index.ts:27` | **FIXED** |
| **NEW-02** | **HIGH** | Regression | F-13 fix dead code — network not passed to constructors | `facilitator/src/facilitator.ts:44-46` | **FIXED** |
| NEW-03 | MEDIUM | New finding | Fee unit mismatch: TS bps (÷10K) vs Move micro-% (÷1M) | `assert.ts`, `math.move`, PTB builders | **FIXED** |

### Resolution Notes (2026-02-28)

**NEW-01 FIXED**: Changed `server/src/index.ts` to import from `./client/s402-fetch` instead of `./client/index`, breaking the module chain that pulled in `@sweefi/sui`.

**NEW-02 FIXED**: Added `network` as 3rd argument to `PrepaidSuiFacilitatorScheme`, `StreamSuiFacilitatorScheme`, and `EscrowSuiFacilitatorScheme` constructors in `facilitator/src/facilitator.ts:44-46`.

**NEW-03 FIXED**: Option (b) was chosen — keep TS SDK in traditional bps, convert at PTB serialization boundary. Added `bpsToMicroPercent()` utility in `assert.ts` and applied it at all 12 PTB builder call sites. Updated escrow facilitator verification to convert before comparing. Added `assertFeeBps()` defense-in-depth to `mandate.ts` and `agent-mandate.ts`. Documentation updated across SPEC.md, ADR-002, ADR-003, and AGENTS.md.

---

## Fix Verification Summary

| Fix ID | Severity | Status | Notes |
|--------|----------|--------|-------|
| F-01 | LOW | ✅ Verified | peerDep correctly moved |
| F-02 | BLOCK | ✅ Fixed | Name removed + import path fixed (NEW-01 resolved) |
| F-03 | BLOCK | ✅ Verified | 10s TTL cache works correctly |
| F-04 | HIGH | ✅ Verified | Fee-free documented in header + routes + SPEC |
| F-05 | HIGH | ✅ Verified | All callers pass network, tests cover testnet |
| F-06 | HIGH | ✅ Verified | fly.toml → /ready with 15s grace |
| F-10 | MEDIUM | ✅ Verified | SPEC says advisory/facilitator-enforced |
| F-11 | MEDIUM | ✅ Verified | facilitator removed from publish, config cleaned |
| F-13 | MEDIUM | ✅ Fixed | Guard exists + network now passed (NEW-02 resolved) |
| F-14 | LOW | ✅ Verified | Doc comment clarifies 0=unlimited convention |
| F-15 | MEDIUM | ✅ Verified | kill_signal=SIGTERM, kill_timeout=15 |
| F-16 | LOW | ✅ Verified | .dockerignore created with sensible exclusions |
| F-17 | LOW | ✅ Verified | Dust guard skips 0-value split correctly |
| F-18 | LOW | ✅ Verified | Description clarifies Sui-specific client subpath |

---

## Regression Risk Checklist

| # | Risk | Status |
|---|------|--------|
| 1 | F-02: Any code imports `adaptWallet` from root? | ✅ Root barrel now imports from `./client/s402-fetch` (NEW-01 fixed) |
| 2 | F-03: Race condition on cache expiry? | ✅ Safe — last-writer-wins, doubled RPC at most once |
| 3 | F-05: Missed `resolveCoinType` callers? | ✅ All callers pass `ctx.network`. CLI has own copy, correct for its format. |
| 4 | F-01: pnpm install resolves correctly? | ✅ Workspace protocol handles peer dep resolution |
| 5 | F-13: Facilitator passes `network` to constructors? | ✅ `network` passed as 3rd arg (NEW-02 fixed) |
| 6 | F-17: Dust guard with `protocolFeeBps > 0`? | ✅ Correct — full amount to `payTo` when fee rounds to zero |

---

## Verdict: ~~CONDITIONAL SHIP~~ → SHIP

> **Updated 2026-02-28**: All 3 findings resolved. Original conditional verdict below for historical context.

All blocking and pre-mainnet fixes have been applied and verified:

1. **NEW-01 FIXED**: Root barrel import path changed to `./client/s402-fetch`
2. **NEW-02 FIXED**: `network` passed as 3rd arg to all scheme constructors
3. **NEW-03 FIXED**: `bpsToMicroPercent()` conversion applied at all 12 PTB builder boundaries; docs harmonized

Verified: 251 tests pass (facilitator 51 + server 6 + sui 194), all 3 packages typecheck clean, built bundles confirmed correct.

---

## Eliminated False Positives

### ~~CLI resolveCoinType uses strict equality~~

**Original concern**: CLI's `parse.ts:20` uses `=== "mainnet"` instead of `.includes("mainnet")`.

**Why it's fine**: CLI context (`context.ts:18,31-38`) validates network against
`["testnet", "mainnet", "devnet"]` and rejects CAIP-2 format (`"sui:testnet"`).
`ctx.network` is always in short format. The strict equality is correct for CLI.

### ~~Circular dependency @sweefi/sui ↔ @sweefi/server~~

**Original concern**: `@sweefi/sui/src/client/s402-client.ts:22` imports from
`@sweefi/server` root, which chains back to `@sweefi/sui` via `wallet-adapter.ts`.

**Why it's manageable**: ESM handles cycles via partial bindings. `toClientSuiSigner` is
defined before `s402-client.ts` in `@sweefi/sui`'s module graph, so the binding resolves.
However, fixing NEW-01 (pointing root barrel to `./client/s402-fetch`) eliminates this
cycle entirely, making this a non-issue post-fix.

---

*Auditor: Claude Opus 4.6 | Session: fresh, no anchoring from fix session*
