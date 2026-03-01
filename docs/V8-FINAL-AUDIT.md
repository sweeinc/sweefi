# SweeFi V8 — Final Pre-Ship Audit Report

> **Purpose**: Independent validation document. Another AI (or human) should be able to
> read this file, read the cited source files, and confirm or refute every finding.
>
> **Date**: 2026-02-28
> **Auditor**: Claude Opus 4.6 (3 validation passes)
> **Scope**: 10 Move modules, 10 TypeScript packages, facilitator infra, documentation
> **Verdict**: CONDITIONAL SHIP — 2 BLOCKs, 3 HIGHs, 4 MEDIUMs, 5 LOWs

---

## How to Vet This Report

For each finding below, the **Verify** section gives exact file paths and line numbers.
A reviewer should:

1. Read the cited file(s)
2. Trace the code path described
3. Confirm or refute the claim
4. Mark the finding as `CONFIRMED`, `REFUTED`, or `NEEDS DISCUSSION`

Findings marked ~~strikethrough~~ were eliminated as false positives during validation.
They are included for transparency so the reviewer can verify the elimination logic.

---

## Prior Audit Fixes (Already Verified — Do Not Re-Report)

These 11 issues were found in prior rounds and have been fixed. All were re-verified
against source during this audit.

| # | Issue | Fix Location | Status |
|---|-------|-------------|--------|
| 1 | `remaining()`/`daily_remaining()`/`weekly_remaining()` returned 0 for unlimited | `agent_mandate.move:414-438` | Verified: returns `0xFFFFFFFFFFFFFFFF` |
| 2 | `validate_and_spend` failed on `max_total=0` | `agent_mandate.move:279` | Verified: `if (mandate.max_total > 0)` guard |
| 3 | `update_caps` allowed `new_max_total < total_spent` | `agent_mandate.move:341-343` | Verified: floor assert |
| 4 | Identity `total_payments`/`total_volume` overflow | `identity.move:254-261` | Verified: saturating add |
| 5 | Stream missing `MIN_DEPOSIT` | `stream.move:47,175,234` | Verified: `MIN_DEPOSIT = 1_000_000` |
| 6 | Bare `#[expected_failure]` tests | All test files | Verified: abort codes specified |
| 7 | `calculate_fee_min()` untested | `math_tests.move:58-91` | Verified: 12 tests added |
| 8 | Facilitator Dockerfile broken | `packages/facilitator/Dockerfile` | Verified: pnpm deploy pattern |
| 9 | No graceful shutdown | `packages/facilitator/src/index.ts:12-19` | Verified: SIGTERM/SIGINT + 10s timeout |
| 10 | AGENTS.md error code table wrong | `AGENTS.md` | Verified: matches source constants |
| 11 | Server package missing CJS exports | `packages/server/package.json` | Verified: require entries present |

---

## Eliminated False Positives (2)

### ~~FP-1: Rate limiter runs on health check endpoints~~

**Original claim**: `app.use("*", rateLimiter.middleware())` at `app.ts:126` applies to
`/health` and `/ready`, so Fly.io health checks could be rate-limited.

**Why it's wrong**: In Hono, middleware and route handlers execute in registration order.
The `/ready` handler at `app.ts:77` and `/health` handler at `app.ts:62` are registered
BEFORE the rate limiter at line 126. These route handlers return `c.json(...)` without
calling `next()`, so the execution chain stops before reaching the rate limiter.

**Verify**: Read `app.ts` lines 58-130. Confirm:
- `app.get("/health", ...)` at line 62 — returns response, no `next()`
- `app.get("/ready", ...)` at line 77 — returns response, no `next()`
- `app.use("*", rateLimiter.middleware())` at line 126 — registered after both routes
- Hono processes the chain in registration order; a handler that returns without `next()` terminates the chain

---

### ~~FP-2: `PaymentController.confirm()` — `awaiting_signature` state is unobservable~~

**Original claim**: Two synchronous `setState()` calls with no `await` between them means
subscribers never see `awaiting_signature`.

**Why it's wrong**: `setState()` at `PaymentController.ts:182-195` is synchronous — it
immediately iterates all listeners and calls them inline:

```typescript
private setState(patch: Partial<PaymentState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch (err) { ... }
    }
}
```

When `confirm()` calls `setState({ status: "awaiting_signature" })` at line 151, every
listener is synchronously notified with `awaiting_signature` BEFORE `setState({ status:
"broadcasting" })` fires at line 157. The state IS observable.

The code comment at lines 153-156 confirms this is intentional design:
```
// Set broadcasting BEFORE the call so the UI actually observes this state
// during the network round-trip. signAndBroadcast is atomic (sign + submit)
```

**Verify**: Read `PaymentController.ts:140-166` and `182-195`. Confirm `setState` is
synchronous and calls listeners inline.

---

## BLOCK Findings (2)

### [BLOCK] F-02: `@sweefi/server` root import crashes for npm consumers

**File**: `packages/server/package.json`, `packages/server/src/index.ts:23`,
`packages/server/src/client/index.ts:4`, `packages/server/src/client/wallet-adapter.ts:3`

**Description**: The root entry point of `@sweefi/server` re-exports `adaptWallet` from
the client subpath, which has an undeclared runtime dependency on `@sweefi/sui`.

Import chain (each arrow = ESM module load, evaluated at import time):

```
import { s402Gate } from '@sweefi/server'
  → dist/index.mjs
    → export { adaptWallet } from "./client/index.mjs"    [src/index.ts:23]
      → export { adaptWallet } from "./wallet-adapter"     [src/client/index.ts:4]
        → import { toClientSuiSigner } from "@sweefi/sui"  [wallet-adapter.ts:3]  ← RUNTIME import
          → MODULE_NOT_FOUND ❌
```

`@sweefi/sui` is not in `@sweefi/server`'s dependencies or peerDependencies
(`package.json:63-77`). ESM resolves all module-level imports at load time — even
re-exports the consumer didn't import. So `import { s402Gate }` triggers the
`@sweefi/sui` resolution and crashes.

**Workaround**: `import { s402Gate } from '@sweefi/server/server'` works — this subpath
only loads `s402-gate.ts` which depends on `s402` (declared dep) and `hono` (peer dep).

**Impact**: The default, documented import path is broken for all npm consumers who don't
also install `@sweefi/sui`. First-time users hit MODULE_NOT_FOUND immediately.

**Fix (option A — minimal)**: Add to `packages/server/package.json`:
```json
"peerDependencies": {
    "hono": ">=4.0.0",
    "@mysten/sui": "^2.0.0",
    "@sweefi/sui": "^0.1.0"
}
```

**Fix (option B — cleaner)**: Remove `adaptWallet` from the root re-export. Keep it in
`@sweefi/server/client` only. Server-side consumers use `@sweefi/server/server` or
`@sweefi/server`; client-side consumers use `@sweefi/server/client`.

**Verify**: Read these files in order:
1. `packages/server/src/index.ts` — line 23 re-exports `adaptWallet` from `./client/index`
2. `packages/server/src/client/index.ts` — line 4 re-exports `adaptWallet` from `./wallet-adapter`
3. `packages/server/src/client/wallet-adapter.ts` — line 3: `import { toClientSuiSigner } from "@sweefi/sui"` (runtime import, not `import type`)
4. `packages/server/package.json` — lines 63-77: no `@sweefi/sui` in deps or peerDeps

---

### [BLOCK] F-03: `/ready` is an unauthenticated, unrate-limited RPC amplification vector

**File**: `packages/facilitator/src/app.ts:77-100`

**Description**: The `/ready` endpoint is:
1. **Unauthenticated** — registered at line 77, before auth middleware at lines 109-113
2. **Makes outbound HTTP calls** — `Promise.all()` at lines 91-95 calls `pingRpc()` for
   both `sui:testnet` and `sui:mainnet`, each making a POST to Sui fullnodes with a
   3-second timeout
3. **Not rate-limited** — as proven in FP-1, the rate limiter at line 126 never runs for
   `/ready` because the route handler returns before it in Hono's execution chain

Each `/ready` request = 2 outbound RPC calls to Sui fullnodes.

**Impact**: An attacker flooding `/ready` at 1000 req/s generates 2000 outbound RPC
calls/s to Sui fullnodes. This can get the facilitator's IP rate-limited or banned by
Sui's public RPC infrastructure, preventing ALL payment settlement.

**Fix**: Cache the `/ready` result for 10-15 seconds:
```typescript
let readyCache: { result: any; expiresAt: number } | null = null;

app.get("/ready", async (c) => {
  const now = Date.now();
  if (readyCache && readyCache.expiresAt > now) {
    return c.json(readyCache.result, readyCache.result.ready ? 200 : 503);
  }
  // ... existing check logic ...
  readyCache = { result, expiresAt: now + 10_000 };
  return c.json(result, ready ? 200 : 503);
});
```

**Verify**: Read `app.ts:26-100`. Confirm:
- `/ready` is registered before auth middleware (line 77 vs lines 109-113)
- It calls `pingRpc()` for both networks (lines 91-95)
- `pingRpc()` makes outbound HTTP POST (lines 28-38)
- No rate limiting reaches this endpoint (see FP-1 elimination above)

---

## HIGH Findings (3)

### [HIGH] F-04: Exact scheme fee mechanism is non-functional

**Files**: `packages/sui/src/s402/exact/client.ts:22-33`,
`packages/sui/src/s402/exact/facilitator.ts:62-75`,
`packages/server/src/server/s402-gate.ts:87-103`

**Description**: Protocol fees for exact payments don't work. The full flow:

1. **Server** (`s402-gate.ts:92-95`): builds requirements with `amount: price` and
   `protocolFeeBps` from config. Does NOT include `protocolFeeAddress` (not a field in
   `s402GateConfig` — see lines 41-67).

2. **Client** (`exact/client.ts:22`): destructures `protocolFeeAddress` from requirements
   → always `undefined`. Line 33: `feeAddress = protocolFeeAddress ?? payTo`. Fee goes
   to merchant address (same as `payTo`).

3. **Client** (`exact/client.ts:37-39`): splits coins — `merchantCoin` to `payTo`,
   `feeCoin` to `payTo`. Both go to the same address. Merchant gets full `totalAmount`.

4. **Facilitator** (`exact/facilitator.ts:73`): checks
   `BigInt(recipientChange.amount) < BigInt(requirements.amount)`. Since both splits went
   to `payTo`, `recipientChange.amount = totalAmount`. Check passes.

**Result**: The fee math runs, the split happens, but both halves go to the same address.
The protocol operator never collects a separate fee.

**Worse**: If a future change adds `protocolFeeAddress` pointing to a different address,
the facilitator's verify would REJECT legitimate payments because the merchant only
receives `amount - fee`, which is less than `requirements.amount`.

**Contrast with escrow** (correctly implemented): `escrow/facilitator.ts:161-170` verifies
`fee_bps` via the on-chain `EscrowCreated` event. Exact has no Move event to inspect.

**Impact**: Revenue model doesn't work for exact payments (the most common payment type).
No fund loss — merchants always get paid. But the facilitator operator collects nothing.

**Fix**: Either:
- (a) Add `protocolFeeAddress` to `s402GateConfig` and requirements, then adjust the
  facilitator verify to check `recipient got >= (amount - fee)` AND `feeAddress got >= fee`
- (b) Document that exact payments are fee-free by design, and fees only apply to
  Move-based schemes (escrow, stream, prepaid) which enforce fees on-chain

**Verify**: Read these files and trace the flow:
1. `s402-gate.ts:41-67` — confirm `protocolFeeAddress` is not in `s402GateConfig`
2. `s402-gate.ts:87-103` — confirm requirements object has no `protocolFeeAddress` field
3. `exact/client.ts:22,33` — confirm `protocolFeeAddress ?? payTo` defaults to `payTo`
4. `exact/client.ts:37-39` — confirm both coins go to `payTo`
5. `exact/facilitator.ts:62-75` — confirm verify only checks recipient amount, not fee

---

### [HIGH] F-05: `resolveCoinType()` returns mainnet USDC on testnet

**File**: `packages/mcp/src/utils/format.ts:266-273`, `packages/sui/src/constants.ts:55-67`

**Description**:
```typescript
// format.ts:266-273
export function resolveCoinType(input?: string): string {
  if (!input) return COIN_TYPES.SUI;
  const upper = input.toUpperCase();
  if (upper === "SUI") return COIN_TYPES.SUI;
  if (upper === "USDC") return COIN_TYPES.USDC;  // ← Always mainnet: 0xdba34...
  if (upper === "USDT") return COIN_TYPES.USDT;
  return input;
}
```

The function has no `network` parameter. `COIN_TYPES.USDC` is the mainnet address
(`0xdba34...`). `TESTNET_COIN_TYPES.USDC` (`0xa1ec7...`) exists at `constants.ts:64-67`
but is never used by this function.

**Impact**: Any MCP agent or CLI user on testnet who says "pay 1 USDC" gets a coin type
that doesn't exist on testnet → transaction aborts with a confusing error.

**Fix**: Add network parameter:
```typescript
export function resolveCoinType(input: string | undefined, network: string): string {
  if (!input) return COIN_TYPES.SUI;
  const upper = input.toUpperCase();
  if (upper === "SUI") return COIN_TYPES.SUI;
  if (upper === "USDC") {
    return network.includes("testnet") ? TESTNET_COIN_TYPES.USDC : COIN_TYPES.USDC;
  }
  if (upper === "USDT") return COIN_TYPES.USDT;
  return input;
}
```

**Verify**: Read `format.ts:266-273`. Confirm no network parameter. Read
`constants.ts:55-67`. Confirm `COIN_TYPES.USDC` is mainnet and `TESTNET_COIN_TYPES.USDC`
exists but differs.

---

### [HIGH] F-06: Fly.io health check targets `/health` (liveness) instead of `/ready` (readiness)

**File**: `packages/facilitator/fly.toml:20-25`

**Description**:
```toml
[[http_service.checks]]
  interval = "15s"
  timeout = "5s"
  grace_period = "10s"
  method = "GET"
  path = "/health"    # ← Should be "/ready"
```

`/health` (`app.ts:62`) returns `{ status: "ok" }` unconditionally. `/ready`
(`app.ts:77-100`) checks scheme registration + Sui RPC connectivity.

**Impact**: Fly.io routes traffic to instances that are alive but can't settle payments
(e.g., Sui RPC is down, schemes failed to register). Users get 500 errors.

**Fix**: Change `fly.toml` line 25:
```toml
  path = "/ready"
```
Also increase `grace_period` to `"15s"` since `/ready` makes outbound RPC calls on cold start.

**Verify**: Read `fly.toml:20-25`. Read `app.ts:62` (`/health` — unconditional ok) vs
`app.ts:77-100` (`/ready` — real checks).

---

## MEDIUM Findings (4)

### [MEDIUM] F-10: SPEC.md claims fee floor not enforced on-chain

**File**: `SPEC.md` (line ~484), `contracts/sources/math.move:68`

**Description**: SPEC.md says "Protocol fee = max($0.01, settlement amount × 50 bps)".
`calculate_fee_min()` exists at `math.move:68` and correctly implements `max(fee, min_fee)`.
But it is NEVER called by any production module. All payment paths call `calculate_fee()`
(no minimum):

- `payment.move:196` — `math::calculate_fee(amount, fee_bps)`
- `stream.move:333,504,632` — `math::calculate_fee(claimable, meter.fee_bps)`
- `escrow.move:298` — `math::calculate_fee(amount, fee_bps)`
- `prepaid.move:453` — `math::calculate_fee(gross_amount, balance.fee_bps)`

**Impact**: Spec claims an on-chain fee floor that doesn't exist. Misleads grant reviewers.
The facilitator could enforce the floor off-chain (reject sub-threshold payments), but the
spec presents it as an on-chain guarantee.

**Fix**: Update SPEC.md to say the floor is advisory/facilitator-enforced, not on-chain.
Or wire `calculate_fee_min()` into production modules (requires governance decision on the
min amount parameter).

**Verify**: `grep -r "calculate_fee_min" contracts/sources/` — should only appear in
`math.move` (definition). `grep -r "calculate_fee" contracts/sources/` — should show all
production calls use `calculate_fee` (no `_min`).

---

### [MEDIUM] F-11: TESTNET-DEPLOY-RUNBOOK publishes `private: true` package

**File**: `packages/facilitator/package.json:4`, `TESTNET-DEPLOY-RUNBOOK.md:302,367,516`

**Description**: `package.json` has `"private": true` (line 4). The runbook includes
`pnpm --filter @sweefi/facilitator publish` at lines 302, 367, and 516. This step will
fail with an npm error.

Also: `package.json` has conflicting signals — `"private": true` alongside
`"publishConfig": { "access": "public" }` (line 16-18) and `"files": [...]` (line 20).

**Impact**: Deploy script errors at this step. Not dangerous (fails safely) but confusing.

**Fix**: Remove `@sweefi/facilitator` from the runbook publish sequence. Clean up
`publishConfig` and `files` if the facilitator is not meant to be published.

**Verify**: Read `packages/facilitator/package.json:4` (private: true) and search
`TESTNET-DEPLOY-RUNBOOK.md` for "facilitator".

---

### [MEDIUM] F-13: Event suffix matching without `packageId` enables spoofing

**File**: `packages/sui/src/s402/stream/facilitator.ts:247-249`

**Description**:
```typescript
const event = packageId
    ? events.find(e => e.type.startsWith(`${packageId}::`) && e.type.endsWith('::StreamCreated'))
    : events.find(e => e.type.endsWith('::stream::StreamCreated'));
```

Without `SWEEFI_PACKAGE_ID`, event extraction uses suffix matching. An attacker can
deploy their own Move contract with a `stream` module emitting `StreamCreated` events
with crafted data. The facilitator logs a warning (`facilitator.ts:31-37`) but continues.

Same pattern exists in escrow and prepaid facilitator schemes.

**Impact**: On testnet (no real money), low risk. On mainnet, an attacker could spoof
events to bypass facilitator verification.

**Fix**: For mainnet, require `SWEEFI_PACKAGE_ID` or refuse to start.

**Verify**: Read `stream/facilitator.ts:243-252`. Confirm the fallback branch uses only
suffix matching. Check `escrow/facilitator.ts` and `prepaid/facilitator.ts` for the same
pattern.

---

### [MEDIUM] F-15: Fly.io `kill_timeout` defaults to 5s, shorter than graceful shutdown

**File**: `packages/facilitator/fly.toml`, `packages/facilitator/src/index.ts:12-16`

**Description**: `fly.toml` has no `kill_signal` or `kill_timeout` configuration. Fly.io
defaults to SIGINT with a 5-second kill timeout. The facilitator's graceful shutdown
(`index.ts:15`) uses `setTimeout(() => process.exit(1), 10_000)` — a 10-second drain
window. Fly.io will SIGKILL the process after 5 seconds, cutting the drain in half.

**Fix**: Add to `fly.toml`:
```toml
kill_signal = "SIGTERM"
kill_timeout = 15
```

**Verify**: Read `fly.toml` — confirm no `kill_signal`/`kill_timeout`. Read `index.ts:15`
— confirm 10-second timeout. Check Fly.io docs for default kill_timeout (5s).

---

## LOW Findings (5)

### [LOW] F-01: `@sweefi/sui` depends on `@sweefi/server` — dep bloat

**File**: `packages/sui/package.json:58`

`@sweefi/sui` declares `"@sweefi/server": "workspace:^"` as a production dependency. This
pulls `@sweefi/server` + `hono` (via peer dep) for consumers who only want PTB builders
(`import from '@sweefi/sui/ptb'`). Not broken — just unnecessary weight.

**Verify**: Read `packages/sui/package.json:56-60`. Confirm `@sweefi/server` is in
`dependencies`.

---

### [LOW] F-14: "0 = unlimited" convention inconsistent between mandate types

**File**: `contracts/sources/mandate.move:155-158`,
`contracts/sources/agent_mandate.move:266-281`

`mandate.move:158` checks `max_total` unconditionally — creating a mandate with
`max_total=0` means it can never spend. `agent_mandate.move:279` wraps the check in
`if (mandate.max_total > 0)` — `max_total=0` means unlimited.

Design choice, not a bug. Both types serve different use cases. Should be documented.

**Verify**: Read `mandate.move:155-158` (unconditional checks). Read
`agent_mandate.move:266-281` (guarded checks with `if > 0`).

---

### [LOW] F-16: No `.dockerignore` in monorepo root

**File**: monorepo root (file missing)

Docker build context includes `contracts/` (~66MB), `docs/`, `.git/`, etc. Increases build
time and cache invalidation. No correctness or security impact.

**Verify**: `ls .dockerignore` at monorepo root — should not exist.

---

### [LOW] F-17: Exact client creates 0-value fee coin when fee rounds to zero

**File**: `packages/sui/src/s402/exact/client.ts:29-39`

When `totalAmount * protocolFeeBps < 10000`, `feeAmount = 0n`. The code creates
`splitCoins(coin, [merchantAmount, 0n])` and transfers a 0-value coin. Wastes gas.

**Fix**: Guard with `if (feeAmount > 0n)` before the split path.

**Verify**: Read `exact/client.ts:29-39`. Trace with `totalAmount=100n, protocolFeeBps=1`.
`feeAmount = (100 * 1) / 10000 = 0`. The split still creates two coins.

---

### [LOW] F-18: `@sweefi/server` description says "chain-agnostic" but client subpath has Sui imports

**File**: `packages/server/package.json:5`

Description: "Chain-agnostic s402 server middleware and fetch wrapper for Hono and Node.js".
But `src/client/wallet-adapter.ts` imports from `@mysten/sui`, and `src/clients/` has
`sui-client-factory.ts` and `seal-client-factory.ts`.

The `./server` subpath IS chain-agnostic. The `./client` subpath is Sui-specific.
Misleading description, not wrong behavior.

**Verify**: Read `package.json:5` (description). Read `client/wallet-adapter.ts` (Sui
imports). Read `server/s402-gate.ts` (no Sui imports).

---

## Summary Table

| ID | Severity | Title | Verify File(s) |
|----|----------|-------|----------------|
| **F-02** | **BLOCK** | `@sweefi/server` root import crashes (undeclared @sweefi/sui dep) | `server/src/index.ts:23` → `client/index.ts:4` → `wallet-adapter.ts:3` |
| **F-03** | **BLOCK** | `/ready` unauthenticated RPC amplification | `facilitator/src/app.ts:77-100` |
| F-04 | HIGH | Exact scheme fee mechanism non-functional | `exact/client.ts:22-33`, `exact/facilitator.ts:62-75`, `s402-gate.ts:41-103` |
| F-05 | HIGH | `resolveCoinType()` returns mainnet USDC on testnet | `mcp/src/utils/format.ts:266-273`, `sui/src/constants.ts:55-67` |
| F-06 | HIGH | Fly.io health check targets `/health` not `/ready` | `facilitator/fly.toml:25`, `facilitator/src/app.ts:62,77` |
| F-10 | MEDIUM | SPEC.md fee floor not enforced on-chain | `math.move:68`, `payment.move:196`, `stream.move:333` |
| F-11 | MEDIUM | Runbook publishes `private: true` package | `facilitator/package.json:4`, `TESTNET-DEPLOY-RUNBOOK.md:302` |
| F-13 | MEDIUM | Event suffix matching enables spoofing without packageId | `stream/facilitator.ts:247-249` |
| F-15 | MEDIUM | Fly.io kill_timeout (5s) < shutdown drain (10s) | `fly.toml`, `facilitator/src/index.ts:15` |
| F-01 | LOW | `@sweefi/sui` → `@sweefi/server` dep bloat | `sui/package.json:58` |
| F-14 | LOW | "0=unlimited" inconsistency between mandate types | `mandate.move:158`, `agent_mandate.move:279` |
| F-16 | LOW | No `.dockerignore` | monorepo root |
| F-17 | LOW | Dust 0-value feeCoin on small payments | `exact/client.ts:29-39` |
| F-18 | LOW | `@sweefi/server` "chain-agnostic" but has Sui imports | `server/package.json:5`, `client/wallet-adapter.ts` |

---

## Ship Checklist — ALL FIXED (2026-02-28)

**BLOCKs (fixed):**
- [x] F-02: Removed `adaptWallet` from root re-export, kept in `/client` subpath
- [x] F-03: Added 10s TTL cache to `/ready` response

**HIGHs (fixed):**
- [x] F-04: Documented exact scheme as fee-free by design, fixed stale routes.ts comment
- [x] F-05: Added `network` param to `resolveCoinType()`, updated all 8 MCP tool callers + tests
- [x] F-06: Changed `fly.toml` health check to `/ready`, increased grace_period to 15s

**MEDIUMs (fixed):**
- [x] F-10: Updated SPEC.md — fee floor is advisory/facilitator-enforced, not on-chain
- [x] F-11: Removed facilitator from runbook publish, cleaned up publishConfig/files
- [x] F-13: Added mainnet packageId requirement to stream/escrow/prepaid facilitator constructors
- [x] F-15: Added `kill_signal = "SIGTERM"` and `kill_timeout = 15` to fly.toml

**LOWs (fixed):**
- [x] F-01: Moved `@sweefi/server` to peerDependencies in `@sweefi/sui`
- [x] F-14: Added doc comments clarifying 0=unlimited convention difference in mandate.move
- [x] F-16: Created `.dockerignore` at monorepo root
- [x] F-17: Added `feeAmount === 0n` guard to skip dust coin creation
- [x] F-18: Updated `@sweefi/server` description to clarify Sui-specific client subpath

**Verification:** All 4 affected packages typecheck clean. 332 TS tests pass. 241 Move tests pass.

---

## Reviewer Template

Copy this to record your validation:

```
## Reviewer: [Name/Model]
## Date: [Date]

### F-02 (BLOCK): @sweefi/server root import
- [ ] Read server/src/index.ts:23 — re-exports adaptWallet?
- [ ] Read client/index.ts:4 — re-exports from wallet-adapter?
- [ ] Read wallet-adapter.ts:3 — runtime import of @sweefi/sui?
- [ ] Read server/package.json:63-77 — @sweefi/sui not in deps?
- Verdict: CONFIRMED / REFUTED / NEEDS DISCUSSION
- Notes:

### F-03 (BLOCK): /ready amplification
- [ ] /ready is before auth middleware?
- [ ] /ready calls pingRpc() for 2 networks?
- [ ] pingRpc() makes outbound HTTP POST?
- [ ] Rate limiter doesn't reach /ready? (see FP-1)
- Verdict: CONFIRMED / REFUTED / NEEDS DISCUSSION
- Notes:

### F-04 (HIGH): Exact fee mechanism
- [ ] s402GateConfig has no protocolFeeAddress field?
- [ ] Requirements object has no protocolFeeAddress?
- [ ] Client defaults feeAddress to payTo?
- [ ] Facilitator checks recipientChange >= amount (not amount - fee)?
- Verdict: CONFIRMED / REFUTED / NEEDS DISCUSSION
- Notes:

### F-05 (HIGH): resolveCoinType mainnet USDC
- [ ] Function has no network parameter?
- [ ] COIN_TYPES.USDC is mainnet address?
- [ ] TESTNET_COIN_TYPES exists but unused here?
- Verdict: CONFIRMED / REFUTED / NEEDS DISCUSSION
- Notes:

### F-06 (HIGH): Fly.io /health vs /ready
- [ ] fly.toml says path = "/health"?
- [ ] /health returns ok unconditionally?
- [ ] /ready checks schemes + RPC?
- Verdict: CONFIRMED / REFUTED / NEEDS DISCUSSION
- Notes:

### FP-1 (eliminated): Rate limiter on health
- [ ] /health registered before rate limiter?
- [ ] /ready registered before rate limiter?
- [ ] Route handlers return without next()?
- Verdict on elimination: AGREE / DISAGREE
- Notes:

### FP-2 (eliminated): awaiting_signature
- [ ] setState is synchronous?
- [ ] Listeners called inline during setState?
- [ ] Code comments explain intentional design?
- Verdict on elimination: AGREE / DISAGREE
- Notes:
```
