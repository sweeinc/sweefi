# SweeFi SDK Architecture Restructure

> **Status**: ✅ COMPLETE — executed 2026-02-20, audited 2026-02-20
> **Date**: 2026-02-20
> **Session**: #150 (plan) → #151 (execution) → #152 (audit) → #153 (council review)
> **Reviewed by**: Claude (Sonnet 4.6) + Gemini adversarial pass + 7-expert coders council (adversarial)
> **Result**: All 6 steps executed. 567 total tests (382 TS + 185 Move). 9 packages live. 10 post-audit security/behavioral fixes applied.

This plan outlined the surgical restructuring of the existing SweeFi monorepo tools into a modular, framework-agnostic package family using Option A (Role-based naming). **Execution complete.**

---

## Proposed Architecture

We will organize the existing `packages/` workspace as follows:

### Protocol Layer
- **`s402`**: The chain-agnostic core protocol spec (untouched).

### Application State & Adapters
- **`@sweefi/ui-core` [NEW]**: Pure Vanilla JS state machine managing the payment flow. Defines the `PaymentAdapter` interface. Depends explicitly on `s402`.
- **`@sweefi/server` [RENAME & PRUNE]**: Formerly `@sweefi/sdk`. Headless Node.js logic for agents and backend gating. Sui-specific exports (`adaptWallet`, `NETWORKS`, `COIN_TYPES`, SEAL/Walrus factories) will be extracted and moved to `@sweefi/sui`.
- **`@sweefi/sui` [AUGMENT]**: Existing package. We will add a `SuiPaymentAdapter` implementation and ingest the Sui-specific exports from the old `@sweefi/sdk`, without touching the existing PTB logic or tests.
- **`@sweefi/sol` [FUTURE]**: Solana implementation.

### UI Frameworks
- **`@sweefi/vue` [NEW]**: Vue bindings (Provide/Inject + Composables like `useSweefiPayment()`).
- **`@sweefi/react` [NEW]**: React bindings (Context + Hooks like `useSweefiPayment()`).

### Tooling (Untouched logic, import updates required if using `@sweefi/sdk`)
- `@sweefi/facilitator`
- `@sweefi/mcp`
- `@sweefi/cli`

### Deprecated
- **`@sweefi/widget` [DELETE]** — Tests migrated to `ui-core`, `vue`, and `react`.

---

## Explicit Contracts & Safeguards

### 1. The PaymentAdapter Interface (`@sweefi/ui-core`)

`PaymentAdapter` accepts an already-connected/initialized signer via injection. It does **not** manage wallet connection lifecycles — that is the host app's responsibility (dapp-kit, RainbowKit, or a raw keypair for headless agents).

```typescript
import type { s402PaymentRequirements } from 's402';

export interface SimulationResult {
  success: boolean;
  estimatedFee?: { amount: bigint; currency: string };
  error?: { code: string; message: string };
}

export interface PaymentAdapter {
  network: string; // e.g. 'sui:mainnet', 'solana:mainnet-beta'
  getAddress(): string | null;
  // Adapter builds the draft transaction internally from reqs — callers don't need per-chain tx knowledge.
  simulate(reqs: s402PaymentRequirements): Promise<SimulationResult>;
  signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }>;
}
```

**Implementation Note for `@sweefi/sui`:** The `SuiPaymentAdapter` constructor must accept a unified configuration object supporting either:
- `{ wallet: WalletClient }` — for browser dApps (dapp-kit, RainbowKit)
- `{ keypair: Ed25519Keypair }` — for headless Node.js agents

### 2. The PaymentController Trigger and State Machine (`@sweefi/ui-core`)

**Trigger API:** The controller exposes a `pay()` method to kick off the state machine from idle:

```typescript
pay(
  targetUrl: string,
  options?: {
    requirements?: s402PaymentRequirements;
  }
): Promise<void>
```

**State Machine:**
```
idle -> fetching_requirements -> simulating -> ready -> awaiting_signature -> broadcasting -> settled -> error
```

**SSR Constraint:** `PaymentController` must be strictly SSR-safe. It cannot access `window`, `localStorage`, or DOM-specific globals during initialization.

### 3. State Subscription Pattern (`@sweefi/ui-core`)

The controller exposes a generic callback-based observer:

```typescript
subscribe(listener: (state: PaymentState) => void): () => void
// Returns an unsubscribe function
```

### 4. React Strict Mode Compliance (`@sweefi/react`)

The `@sweefi/react` bindings must explicitly use `useSyncExternalStore` to safely bind the `subscribe` pattern. This prevents subscription memory leaks and double-invocation bugs in React 18+ Strict Mode and Concurrent rendering environments.

### 5. Circular Dependency Warning

> **CRITICAL:** Under no circumstances should `@sweefi/ui-core` import anything from `@sweefi/sui`. The dependency direction is strictly one-way: `@sweefi/sui` → `@sweefi/ui-core`.

---

## Proposed Changes

### Step 1: `@sweefi/ui-core` [Create]
- Create `packages/ui-core/`
- Add `s402` to `package.json` dependencies
- Add `src/interfaces/PaymentAdapter.ts` (interface + `SimulationResult` as specified above)
- Add `src/controllers/PaymentController.ts` using the trigger API, state machine, and subscribe pattern defined above
- **MIGRATE:** Move controller tests from `packages/widget/test/` to `packages/ui-core/test/`

### Step 2: `@sweefi/server` [Rename & Prune]
- Rename `packages/sdk` → `packages/server`
- Update `package.json` name and exports
- **CRITICAL:** Remove all Sui-specific exports (`adaptWallet`, `NETWORKS`, `COIN_TYPES`, SEAL/Walrus factories). `@sweefi/server` must be strictly chain-agnostic.

### Step 3: `@sweefi/sui` [Augment]
- Add `src/adapters/SuiPaymentAdapter.ts` implementing `PaymentAdapter` from `@sweefi/ui-core` (wallet/keypair injection)
- Move Sui-specific constants and utilities pruned from `@sweefi/sdk` into this package

### Step 4: `@sweefi/vue` [Create]
- Create `packages/vue/`
- Build Vue plugin to inject `PaymentController` instance
- Build `useSweefiPayment()` composable
- **MIGRATE:** Move Vue component tests from `packages/widget/test/` to `packages/vue/test/`

### Step 5: `@sweefi/react` [Create]
- Create `packages/react/`
- Build React bindings using `useSyncExternalStore` for `useSweefiPayment()`
- **MIGRATE:** Move React component tests from `packages/widget/test/` to `packages/react/test/`

### Step 6: `@sweefi/widget` [Delete]
- Remove `packages/widget/` **only after** all 6 original tests have been migrated and pass in their new locations

### Step 7: NPM Publish Queue [Update]
- ✅ READY-QUEUE.md updated to reflect correct publish sequence:
  ```
  s402 → @sweefi/ui-core → @sweefi/server → @sweefi/sui → @sweefi/vue → @sweefi/react → @sweefi/mcp → @sweefi/cli
  ```
  Note: `@sweefi/server` before `@sweefi/sui` (sui depends on server).

---

## Verification Plan

### Automated Tests
- [x] Unit tests for `PaymentController` in `@sweefi/ui-core` — 13 tests passing
- [x] Unit tests for Vue bindings in `@sweefi/vue` — 10 tests passing
- [x] Unit tests for React bindings in `@sweefi/react` — 12 tests passing
- [x] Unit tests for `SuiPaymentAdapter` in `@sweefi/sui` — 189 tests passing (existing PTB tests preserved)
- [x] `@sweefi/server` scripts/tests pass after Sui export pruning — passWithNoTests: true added for integration-only package

### Manual Verification
- [ ] Dogfood the architecture by integrating `@sweefi/vue` + `@sweefi/sui` into the Swee Landing Page to confirm reactivity and wallet integration work end-to-end.

---

## Post-Audit Fixes (2026-02-20)

A full adversarial audit (10-phase + 7-expert coders council) found and fixed 10 issues after the restructure was complete. No breaking API changes — all fixes are behavioral correctness, security hardening, or documentation accuracy.

| # | Package | Fix | Impact |
|---|---------|-----|--------|
| 1 | `@sweefi/cli` | Added missing `prepublishOnly` gate | Publish safety — broken build could not have published |
| 2 | 5 packages | Fixed `files` arrays: `["dist", "README.md", "LICENSE"]` — included `.map` source maps | Source maps now published; stack traces readable in production |
| 3 | `READY-QUEUE.md` | `npm publish` → `pnpm publish` for all 8 publish steps | Critical: `npm publish` publishes literal `workspace:*` strings; pnpm rewrites them |
| 4 | `AGENTS.md` | Dep diagram: `facilitator → @sweefi/server` → `facilitator → @sweefi/sui` | Documentation accuracy |
| 5 | `PaymentController` | `setState({ status: "broadcasting" })` moved **before** `await signAndBroadcast()` | UI can now actually observe the `broadcasting` state during network round-trip |
| 6 | `PaymentController` | Listener `setState` loop wrapped in `try/catch` per listener | One throwing subscriber no longer silences all subsequent subscribers |
| 7 | `useSweefiPayment.ts` (Vue) | `onUnmounted` → `onScopeDispose` | Prevents subscription leaks when composable is called from Pinia stores or `effectScope()` |
| 8 | `facilitator/config.ts` | `API_KEYS: z.string().min(1)` → `.refine()` enforcing ≥16 chars per key | Eliminates trivially brute-forceable API keys |
| 9 | `facilitator/facilitator.ts` | `console.warn` added when `SWEEFI_PACKAGE_ID` is unset | Operators alerted that Move event anti-spoofing is disabled without this env var |
| 10 | `facilitator/test/config.test.ts` | Test fixtures updated to use ≥16 char API keys | Tests pass with the new validation; fixtures now model real-world key entropy |

**False positives vetted and dismissed** (7 total): shadow PTB divergence (code was identical), React docs recommendation, CORS gap (no browser clients), CLI exports footgun (private package), prompt injection (SEAL content; documented trust boundary), engines inconsistency, s402 peerDep discussion.

---

## Dependency Graph (Reference)

```
s402  (protocol, untouched)
  ├── @sweefi/server     (headless agents + server gating)
  └── @sweefi/ui-core    (UI state machine + PaymentAdapter interface)
        ├── @sweefi/sui  (SuiPaymentAdapter — wallet or keypair)
        ├── @sweefi/vue  (Vue plugin + useSweefiPayment)
        └── @sweefi/react (React context + useSweefiPayment)

@sweefi/sui also feeds:
  @sweefi/facilitator, @sweefi/mcp, @sweefi/cli  (untouched)
```
