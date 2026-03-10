# SweeFi — AGENTS.md (Codebase Manual)

> For any AI agent (Claude Code, Codex, Gemini CLI) working on this project.
> **READ THIS BEFORE TOUCHING ANY CODE.**

## Project Overview

**SweeFi** is open-source agentic payment infrastructure for Sui.
- Monorepo with 10 TS packages + Move smart contracts
- Built on top of `s402` (HTTP 402 protocol, published on npm as `s402@0.2.2`)
- Competing with BEEP (justbeep.it) — proprietary alternative
- 1,102 passing tests (809 TypeScript + 293 Move) — see STATUS.md for per-package breakdown

## Repository Structure

```
sweefi-project/
├── contracts/                    # Move smart contracts (10 modules, 264 test functions)
│   └── sources/
│       ├── payment.move          # Direct payments, invoices, receipts
│       ├── stream.move           # Streaming micropayments + budget caps
│       ├── escrow.move           # Time-locked escrow + arbiter disputes
│       ├── seal_policy.move      # SEAL integration (pay-to-decrypt)
│       ├── mandate.move          # Basic spending delegation, revocation
│       ├── agent_mandate.move    # L0-L3 progressive autonomy, lazy reset
│       ├── prepaid.move          # Deposit-based agent budgets, batch-claim
│       ├── identity.move         # Agent identity (did:sui profiles)
│       ├── math.move             # Shared math utilities (safe division, micro-percent fees)
│       └── admin.move            # Emergency pause, admin capabilities
├── packages/
│   ├── ui-core/                  # Framework-agnostic state machine + PaymentAdapter interface (13 tests)
│   ├── server/                   # Chain-agnostic HTTP: s402Gate, wrapFetchWithS402 (integration only)
│   ├── sui/                      # 42 PTB builders + SuiPaymentAdapter + s402 schemes (252 tests)
│   ├── vue/                      # Vue 3 plugin + useSweefiPayment() composable (10 tests)
│   ├── react/                    # React context + useSweefiPayment() hook (12 tests)
│   ├── facilitator/              # Self-hostable payment verification — private, Docker only (57 tests)
│   ├── mcp/                      # MCP server, 35 AI agent tools (124 tests)
│   ├── cli/                      # CLI tool — wallet, pay, prepaid, mandates (43 tests)
│   ├── ap2-adapter/              # AP2 ↔ SweeFi mandate mapper + bridge (52 tests)
│   └── solana/                   # Solana s402 exact scheme adapter
├── demos/
│   ├── agent-pays-api/           # Working agent demo (server + client + e2e)
│   └── seal-e2e/                 # SEAL pay-to-decrypt demo
├── docs/
│   ├── adr/                      # Architecture Decision Records — see index below
│   └── ...                       # VitePress docs site
├── GRANT-APPLICATION.md          # Sui DeFi Moonshots grant application
├── BATTLE-PLAN.md                # Competitive strategy vs BEEP
└── SPEC.md                       # Full specification and vision
```

## Build & Test

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run all TS tests
pnpm -r test

# Typecheck all packages
pnpm -r typecheck

# Run Move tests
cd contracts && sui move test

# Single package
pnpm -r --filter @sweefi/mcp test
pnpm -r --filter @sweefi/sui build
```

### Changesets (Versioning & Publishing)

SweeFi uses [changesets](https://github.com/changesets/changesets) for versioning.
When you make a user-visible change, add a changeset:

```bash
pnpm changeset                 # interactive — pick packages + semver bump
pnpm changeset status          # see pending changesets
pnpm version                   # consume changesets → bump package.json versions + write CHANGELOGs
pnpm release                   # build all + publish to npm
```

Or create `.changeset/<name>.md` manually:

```markdown
---
"@sweefi/sui": minor
"@sweefi/mcp": patch
---

Description of the change.
```

**Rules**:
- Breaking API changes (param renames, removed exports) → `minor` (pre-1.0) or `major` (post-1.0)
- New features, additive changes → `minor`
- Bug fixes, internal refactors → `patch`
- `@sweefi/facilitator` is ignored (private, not published)
- `updateInternalDependencies: "patch"` — downstream packages auto-get patch bumps when deps change

### E2E Testing with Testcontainers (Future)

When SweeFi needs E2E tests against a live Sui network (e.g., facilitator settlement tests, Move contract integration), use the **Testcontainers pattern** from MystenLabs/ts-sdks:

```typescript
// vitest globalSetup.ts
import { GenericContainer, Network } from 'testcontainers';

const SUI_TOOLS_TAG = 'latest-arm64'; // pin to specific commit hash for CI

export default async function setup(project) {
  const network = await new Network().start();

  // Postgres for Sui indexer
  const pg = await new GenericContainer('postgres')
    .withEnvironment({ POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'sui_indexer_v2' })
    .withExposedPorts(5432)
    .withNetwork(network)
    .start();

  // Full Sui node with faucet + GraphQL + indexer
  const sui = await new GenericContainer(`mysten/sui-tools:${SUI_TOOLS_TAG}`)
    .withCommand(['sui', 'start', '--with-faucet', '--force-regenesis', '--with-graphql',
      `--with-indexer=postgres://postgres:pw@${pg.getIpAddress(network.getName())}:5432/sui_indexer_v2`])
    .withExposedPorts(9000, 9123, 9124, 9125)
    .withNetwork(network)
    .start();

  // Ports: 9000=JSON-RPC, 9123=Faucet, 9124=gRPC, 9125=GraphQL
  project.provide('localnetPort', sui.getMappedPort(9000));
  project.provide('faucetPort', sui.getMappedPort(9123));
}
```

**Why this pattern**: Random port mapping eliminates conflicts, `--force-regenesis` gives clean state every run, containers auto-cleanup on exit. Requires Docker Desktop running — nothing else.

**Reference**: `external/ts-sdks-fork/packages/sui/test/e2e/utils/globalSetup.ts`

---

## Architecture Overview

### The Two Layers

```
Move Contracts (on-chain)          TypeScript SDK (off-chain)
─────────────────────────          ────────────────────────────
payment.move   → receipts          @sweefi/sui  → PTB builders
stream.move    → streaming         @sweefi/server → s402Gate middleware
escrow.move    → time-locked       @sweefi/ui-core → state machine
seal_policy.move → pay-to-decrypt  @sweefi/vue, react → UI bindings
mandate.move   → basic delegation  @sweefi/mcp → 30 AI agent tools
agent_mandate.move → L0-L3 auth    @sweefi/facilitator → verifier service
prepaid.move   → batch budgets     @sweefi/cli → dev CLI tool
identity.move  → did:sui profiles  s402 (external) → HTTP 402 protocol
math.move      → shared math
admin.move     → emergency pause
```

### The Payment Flow (one PTB)

```
1. Client calls buildPayAndProveTx()          ← @sweefi/sui
2. Human signs the PTB                        ← wallet
3. Facilitator verifies + broadcasts          ← @sweefi/facilitator
4. On-chain: payment::pay() executes          ← payment.move
5. PaymentReceipt created, owned by buyer     ← key + store object
6. Buyer presents receipt to SEAL key server  ← dry-run seal_approve()
7. SEAL releases decryption key               ← seal_policy.move
```

---

## Architecture Decision Records (ADR Index)

All major decisions are documented with their rationale in `docs/adr/`. Before
proposing a change that touches any of these areas, **read the relevant ADR first**.

| ADR | Title | Key Rule |
|-----|-------|----------|
| ADR-001 | Composable PTB Pattern | `public` functions return objects; `entry` functions transfer them. Never collapse these into one. |
| ADR-002 | Batch Claims & Gas Economics | Gas break-even is ~17s claim intervals; recommend 5min+. |
| ADR-003 | Fee Rounding & Financial Precision | Always use u128 intermediate. Always truncate (floor). Never use floating-point in money paths. Denominator is 1,000,000 (micro-percent), not 10,000 (bps). Both TS SDK and Move use micro-percent natively. `bpsToMicroPercent()` is a public convenience only. |
| ADR-004 | AdminCap & Emergency Pause | Two-tier: pause blocks new deposits, NEVER blocks exits. AdminCap has no fund extraction rights. |
| ADR-005 | Permissive Access & Receipt Transferability | Receipts are bearer credentials. Ownership = access. No sender checks. |
| ADR-006 | Object Ownership Model | Owned = one-party mutations (fast path). Shared = multi-party mutations (consensus). |
| ADR-007 | Prepaid Trust Model | v0.1 = economic trust bounds. v0.2 = signed receipts + fraud proofs. v0.3 = provider-submitted receipts (self-enforcing). v0.4 = TEE attestation. |
| ADR-008 | Facilitator API Gaps | `GET /ready` checks RPC (not just config). `/settlements` is per-key only (fleet-wide = info leak). Dedup key must include apiKey (cross-tenant collision). 4xx/5xx not cached. |

---

## Key Design Decisions (Load-Bearing — Do Not Subvert)

### 1. Owned vs Shared Objects (ADR-006)

```
Owned objects (fast path, ~200ms, no consensus):
  PaymentReceipt, EscrowReceipt, Invoice

Shared objects (consensus path, ~2-3s):
  StreamingMeter<T>, Escrow<T>, PrepaidBalance, ProtocolState
```

**Rule**: An object is shared only when multiple distinct addresses mutate it.
Read-only multi-party access does NOT require sharing.

### 2. u128 Intermediate Math + Micro-Percent Fee Units (ADR-002 §4, ADR-003)

The Cetus protocol lost $223M to a u64 overflow. SweeFi uses u128 for all
fee and amount calculations involving multiplication.

**Fee denominator is 1,000,000 (micro-percent), not 10,000 (bps).**
Both Move contracts and the TS SDK use micro-percent natively (`feeMicroPercent: number`,
`fee_micro_pct: u64`). `FEE_DENOMINATOR = 1_000_000` enables sub-bps precision at
AI agent micropayment scale. A public `bpsToMicroPercent()` convenience is available for
callers who think in traditional basis points, but it's not used internally by PTB builders.

```move
// CORRECT — all modules share sweefi::math::calculate_fee():
const FEE_DENOMINATOR: u128 = 1_000_000; // 1,000,000 = 100%
let result = ((amount as u128) * (fee_micro_pct as u128)) / FEE_DENOMINATOR;
assert!(result <= (0xFFFFFFFFFFFFFFFF as u128), EOverflow);
(result as u64)

// NEVER do this — overflows at ~1.8 × 10^15 tokens:
let fee = amount * fee_micro_pct / 1_000_000;
```

All fee math lives in `contracts/sources/math.move`. Individual modules
(`payment.move`, `stream.move`, `escrow.move`, `prepaid.move`) call `math::calculate_fee()`.

### 3. Two-Tier Pause Model (ADR-004)

The `ProtocolState` pause flag blocks NEW operations entering the system, but
**exits are always open**. This is the invariant that makes the pause safe.

| Module | Guarded (blocked when paused) | Unguarded (always allowed) |
|--------|-------------------------------|---------------------------|
| stream | `create`, `create_with_timeout`, `top_up` | `claim`, `pause`, `resume`, `close`, `recipient_close` |
| escrow | `create` | `release`, `refund`, `dispute` |
| payment | _(nothing)_ | Everything (no shared-object read overhead) |
| seal_policy | _(nothing)_ | Everything (read-only) |

Error codes: `EAlreadyPaused = 500`, `ENotPaused = 501`.

### 4. SEAL Bearer Model — Ownership = Access (ADR-005)

SEAL decryption rights follow **object ownership**, not the original buyer's address.
This was clarified by the HIGH finding in SECURITY-REVIEW-A.md (H-1):

```move
// WRONG (old, broken) — locked to original buyer forever:
assert!(ctx.sender() == escrow::receipt_buyer(receipt), ENotBuyer);

// CORRECT (current) — Sui ownership enforces holder-only access:
// No sender check needed. If you can pass the receipt as a transaction arg,
// you own it. Possession IS the access check.
```

Never add `ctx.sender()` checks to `seal_approve` or `check_policy`. Sui's
object ownership model is the enforcement mechanism.

### 5. Prepaid: Cumulative Counts (Idempotent) (ADR-007)

`claim(balance, cumulative_count)` takes the **total calls ever made**, not a delta.
This makes claims idempotent — submitting the same count twice is safe (Move checks
`assert!(new_count > balance.total_calls, EAlreadyClaimed)`).

This also means counts should never decrease. If a provider submits `claim(_, 100)`,
the next valid call must be `claim(_, ≥101)`.

### 6. Zero-Delta No-Ops Are Blocked

Any operation that would transfer `0` tokens is blocked at the contract level.
This prevents dust-spam on shared objects and aligns with `MIN_DEPOSIT = 1_000_000 MIST`.

- `stream.top_up(0)` → aborts
- `prepaid.claim` with identical count → aborts
- Fee calculations of 0 on 0-fee routes → pass through (not an op, not blocked)

### 7. Permissionless Exits

Both `stream.recipient_close()` and `escrow` deadline refunds are permissionless.
Anyone can call them (after the timeout/deadline). This ensures funds cannot be
locked forever by payer inaction.

---

## What NOT to Do

These are hard rules. Do not debate them; read the ADR if you want context.

| ❌ Never | Reason |
|---------|--------|
| Add admin powers to withdraw funds from streams/escrows/prepaid | ADR-004: AdminCap is pause-only, no fund extraction |
| Use u64 multiplication without u128 intermediate | ADR-003: Cetus lost $223M this way |
| Add `ctx.sender()` checks to `seal_approve` | ADR-005: Sui ownership IS the check — a sender check breaks the bearer model |
| Make exits (close, refund, withdraw, recipient_close) pausable | ADR-004: Users must always be able to exit |
| Allow `is_id_revoked()` without first asserting `registry.owner == mandate.delegator` | V8 H-1 fix: rogue delegates can pass empty registries to bypass revocation |
| Use `sui move publish` for deployment | This is a local command. Use `sui client publish --gas-budget 500000000` |
| Install npm packages | Ask Danny first — no silent dependency additions |
| Commit or push | Danny reviews before any git operations |

---

## Smart Contracts (Sui Testnet)

Package ID: `0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5`
Contract version: 0.1.0 (pre-mainnet). 11th testnet iteration (auto-unpause + MC/DC). Full history in git log.

10 modules, 293 Move test functions (all passing). MC/DC coverage on 4 authorization-critical functions (agent_mandate, mandate, prepaid, escrow).

**Key design patterns:**
- All payment functions are `public` (composable in PTBs), not `entry`
- Receipts are owned objects (transferable, usable as SEAL conditions)
- Streams have permissionless recipient close (abandoned stream recovery)
- Escrows have permissionless deadline refund (no funds locked forever)
- `seal_policy::seal_approve()` is called in dry-run by SEAL key servers

### Move Error Code Series (by module)

| Module | Series | Key Codes |
|--------|--------|-----------|
| payment | 0s | EInsufficientPayment=0, EZeroAmount=1, EInvalidFeeBps=2 |
| stream | 100s | ENotPayer=100, ENotRecipient=101, EZeroDeposit=105, EBudgetCapExceeded=108, ETimeoutTooShort=110, ETimeoutTooLong=111 |
| escrow | 200s | ENotBuyer=200, ENotSeller=201, ENotArbiter=202, EDeadlineNotReached=205, EAlreadyDisputed=208, EArbiterIsSeller=212 |
| seal_policy | 300 | ENoAccess=300 |
| mandate | 400s | ENotDelegate=400, EExpired=401, EPerTxLimitExceeded=402, ETotalLimitExceeded=403, ENotDelegator=404, ERevoked=405 |
| admin | 500s | EAlreadyPaused=500, ENotPaused=501 |
| agent_mandate | 550s | ENotDelegate=550, EExpired=551, EPerTxLimitExceeded=552, EDailyLimitExceeded=556, EInvalidLevel=558, ECannotDowngrade=560 |
| prepaid | 600s | ENotAgent=600, ENotProvider=601, EZeroDeposit=602, EWithdrawalLocked=604, ECallCountRegression=605 |
| identity | 700s | EAlreadyRegistered=700, ENotOwner=701, EReceiptAlreadyRecorded=705 |
| math | 900 | EOverflow=900 |

**Critical**: `mandate::is_id_revoked(registry, id)` does NOT check `registry.owner == mandate.delegator`.
All callers must assert ownership BEFORE calling it. This was the V8 H-1 security fix.

### Notable Security Fixes (pre-publication audit)

- `resume()` accrual theft fix (time-shift pattern)
- Revocation bypass fix (registry ownership assertion required before `is_id_revoked`)
- `remaining()` saturated subtraction (no underflow)
- Error code collision fix (agent_mandate → 550s series)
- Event spoofing fix (packageId required on non-exact schemes)
- TOCTOU race fix (atomic `tryConsume` for gas sponsorship)
- Error message sanitization (no internal details leaked to clients)
- **Semantic fix**: `0 = zero budget` across all caps (was "0 = unlimited" in agent_mandate — now consistent with mandate.move; use `u64::MAX` for unlimited)

**Move test deposits must be ≥ MIN_DEPOSIT (1,000,000 MIST).** Any fixture with smaller deposits
aborts at `create()`, not at assertions — the failure is confusing. Always use ≥ 1M in Move tests.

---

## Package Dependencies

```
@sweefi/mcp ────────────► @sweefi/sui
@sweefi/cli ────────────► @sweefi/sui
@sweefi/facilitator ────► @sweefi/sui     (private: true — not on npm)
                              ▲
@sweefi/sui ────────────► @sweefi/server
                         @sweefi/ui-core
@sweefi/vue ────────────► @sweefi/ui-core
@sweefi/react ──────────► @sweefi/ui-core

External: s402@0.2.0 (npm), @mysten/sui@2.4.0, @mysten/seal@1.0.1

Dependency direction (strict — never reverse):
  s402 ← @sweefi/server ← @sweefi/sui ← @sweefi/mcp, @sweefi/cli
  s402 ← @sweefi/ui-core ← @sweefi/sui, @sweefi/vue, @sweefi/react
```

---

## Architecture Decisions

1. **Sign-first model**: Client signs PTB, facilitator verifies + broadcasts
2. **s402 protocol**: Sui-native HTTP 402 payment protocol
3. **Hono over Express**: Lighter, edge-compatible
4. **tsdown bundler**: NOT tsup (tsup is EOL)
5. **Composable PTBs**: `buildPayAndProveTx()` combines pay + receipt transfer atomically (see ADR-001 in packages/sui/)
6. **MCP-native**: 30 tools (+ 5 opt-in) registered on MCP server for AI agent discovery
7. **Role-based packages**: ui-core (state machine) + sui (adapter) + vue/react (bindings) — not framework-coupled
8. **PaymentAdapter interface**: `@sweefi/ui-core` defines the interface; `@sweefi/sui` implements it. Adding Solana is a new adapter, not a new framework dependency.
9. **PaymentController state ordering**: `setState({ status: "broadcasting" })` MUST be called BEFORE `await adapter.signAndBroadcast()`. The `broadcasting` state represents work in progress during the network round-trip — if set after the `await`, the UI transitions directly from `awaiting_signature` to `settled` with no observable `broadcasting` state.

---

## s402 / SweeFi Boundary (CRITICAL — Read Before ANY Code Change)

**s402 is chain-agnostic. SweeFi is chain-specific.** This boundary is load-bearing:

| Concern | Belongs in | NOT in |
|---------|-----------|--------|
| Address format validation (Sui `0x` + 64 hex) | `@sweefi/sui` (constants.ts, utils.ts) | `s402` |
| Amount magnitude checks (u64 max) | `@sweefi/sui` | `s402` |
| Chain SDK imports (`@mysten/sui`) | `@sweefi/sui` | `s402` |
| Coin type defaults (`0x2::sui::SUI`) | `@sweefi/sui` | `s402` |
| Wire format, HTTP encoding, scheme interfaces | `s402` | `@sweefi/sui` |

**If you need chain-specific validation**, add it in `@sweefi/sui` — the correct layer. The s402 package validates structure and safety only (non-empty strings, no control characters, numeric format). It has a `test/boundary.test.ts` that will fail the build if chain-specific patterns leak in.

**Why this exists:** In Feb 2026, multiple AI sessions introduced Sui-specific validation into s402's protocol layer. It survived through 4-6 AI sessions because each one assumed prior work was correct. The `@sweefi/sui` package already has `validateSuiAddress()` and `SUI_ADDRESS_REGEX` in `constants.ts` / `utils.ts` — that's where chain validation belongs.

---

## Key Dependencies

- `@mysten/sui` — Sui TypeScript SDK (peerDep: `^2.0.0`)
- `@modelcontextprotocol/sdk@^1.26.0` — MCP server SDK
- `s402@^0.2.0` — s402 payment protocol core
- `hono@^4.0.0` — Web framework (facilitator)
- `zod@^3.22.0` — Runtime validation

---

## MCP Server (30 Default + 5 Opt-In Tools)

The MCP package registers 30 tools by default + 5 opt-in (admin + provider).

**Payments** (4): `pay`, `pay_and_prove`, `create_invoice`, `pay_invoice`
**Streaming** (4): `start_stream`, `start_stream_with_timeout`, `stop_stream`, `recipient_close_stream`
**Escrow** (4): `create_escrow`, `release_escrow`, `refund_escrow`, `dispute_escrow`
**Prepaid** (7): `prepaid_deposit`, `prepaid_top_up`, `prepaid_request_withdrawal`, `prepaid_finalize_withdrawal`, `prepaid_cancel_withdrawal`, `prepaid_agent_close`, `prepaid_status`
**Mandates** (7): `create_mandate`, `create_agent_mandate`, `basic_mandated_pay`, `agent_mandated_pay`, `revoke_mandate`, `create_registry`, `inspect_mandate`
**Read-Only** (4): `check_balance`, `check_payment`, `get_receipt`, `supported_tokens`
**Opt-In Provider** (`MCP_ENABLE_PROVIDER_TOOLS=true`): `prepaid_claim`
**Opt-In Admin** (`MCP_ENABLE_ADMIN_TOOLS=true`): `protocol_status`, `pause_protocol`, `unpause_protocol`, `burn_admin_cap`

All tool names prefixed with `sweefi_`. Transaction tools require `SUI_PRIVATE_KEY` env var.

---

## Packaging & Publishing Conventions

**Publish order** (dependencies must publish before consumers):
```
s402 → @sweefi/ui-core → @sweefi/server → @sweefi/sui → @sweefi/vue → @sweefi/react → @sweefi/mcp → @sweefi/cli
```

Note: `@sweefi/facilitator` is `private: true` — self-hostable via Docker/Fly.io, NOT published to npm.

**Build tool**: `tsdown` (NOT tsup — tsup is EOL). Config in each package's `tsdown.config.ts`.

**Source maps**: INCLUDE in published packages. MCP servers and facilitators run as subprocesses — stack traces need readable paths. The size overhead is trivial (~164KB for MCP). The `files` array should be `["dist", "README.md", "LICENSE"]` which includes `.map` files.

**CLI/library split pattern** (applies to `@sweefi/mcp` only):
- `src/index.ts` — Pure re-exports only. No side effects. Imported as a library.
- `src/cli.ts` — Shebang + `main()` + stdio transport. Used by `bin` in package.json.
- ESM has no `require.main === module`. Calling `main()` at module level in `index.ts` would start a server on every `import`.
- Note: `@sweefi/facilitator` is `private: true` with no `exports` field — it's a Docker service run via `node dist/index.mjs`, never imported as a library, so this split does not apply.

**peerDependencies**: `@mysten/sui` is a peer dep (`^2.0.0`), not a direct dep. This avoids duplicate SDK instances when consumers also use the Sui SDK. `vue` and `react` are peer deps of their respective packages.

**prepublishOnly gate**: Every package must have `"prepublishOnly": "pnpm run build && pnpm run typecheck && pnpm run test"`. This ensures nothing publishes broken.

**Version constant**: `server.ts` has a `VERSION` constant that must match `package.json`. The prepublishOnly script catches drift at publish time (typecheck + test).

**workspace:\* protocol**: `pnpm publish` automatically rewrites `workspace:*` to real versions. NEVER use `npm publish` — it would publish literal `workspace:*` strings.

---

## Common Pitfalls

1. **USDC address differs by network**: Check `COIN_TYPES` / `TESTNET_COIN_TYPES` constants in `@sweefi/sui/src/constants.ts`
2. **Sign-first means no execution on client side**: SDK uses `signTransaction()` not `signAndExecuteTransaction()`
3. **Buffer doesn't exist in browser**: Use `toBase64`/`fromBase64` from @mysten/sui/utils
4. **Escrow export is plural**: `registerEscrowTools` (4 tools), not `registerEscrowTool`
5. **Integration dry-run tests are opt-in live lane**: run `pnpm test:live` (requires network; default `pnpm test` is offline-safe)
6. **useSyncExternalStore snapshot caching**: `PaymentController.getState()` returns `{ ...this.state }` (new object each call). The `@sweefi/react` hook caches the snapshot in a `useRef` — do not remove this or you'll get infinite re-render loops.
7. **`@sweefi/widget` is deleted**: Do not reference it. All UI logic is now in `@sweefi/ui-core`, `@sweefi/vue`, and `@sweefi/react`.
8. **Vue: use `onScopeDispose`, not `onUnmounted`**: In `@sweefi/vue` composables, cleanup subscriptions with `onScopeDispose` (Vue 3.1+). `onUnmounted` only fires in component `setup()` — it warns and leaks when called from a Pinia store or `effectScope()`.
9. **Facilitator API keys must be ≥ 16 characters**: The Zod config validates each key individually after splitting on commas. A short key (even one of many) causes the server to refuse startup. Use `openssl rand -hex 32` to generate keys.
10. **Move test deposits must be ≥ MIN_DEPOSIT (1,000,000 MIST)**: `escrow.move`, `prepaid.move`, and `stream.move` enforce `MIN_DEPOSIT = 1_000_000`. Any test fixture using a smaller deposit (e.g. `10_000`) will abort at the `create` call — not at an assertion — making the failure confusing. Always use deposits ≥ 1M in Move tests. Downstream amount assertions must be recalculated: e.g. 50bps fee on 1M = 5_000 MIST (not 50).
11. **RevocationRegistry ownership MUST be checked before `is_id_revoked()`**: The `mandate::is_id_revoked(registry, id)` helper is a low-level check — it does NOT verify that `registry.owner == mandate.delegator`. Any call site MUST assert ownership first, otherwise a malicious delegate can pass their own empty registry to bypass revocation. Pattern: `assert!(mandate::registry_owner(registry) == mandate.delegator, ENotDelegator)`.
12. **Move u64 subtraction aborts on underflow — no wrapping**: Unlike Rust or Solidity, Move's u64 arithmetic aborts (not wraps) on underflow. Any view function that computes `a - b` where `b` could exceed `a` (e.g., `remaining()` after a cap reduction) needs an explicit saturation guard: `if (b >= a) { 0 } else { a - b }`.
13. **`sui move publish` is wrong — use `sui client publish`**: `sui move` subcommands are for local build/test only. On-chain deployment requires: `sui client publish --gas-budget 500000000` run from the `contracts/` directory.
14. **`@sweefi/mcp` signs internally — not unsigned PTB return**: Both `sweefi_pay` and `sweefi_prepaid_deposit` call `signAndExecuteTransaction({signer, transaction})` internally using `SUI_PRIVATE_KEY`. No adapter or external signing is needed. The `requireSigner(ctx)` helper throws a clear error if the key is missing.
15. **`seal_approve` must NOT check `ctx.sender()`**: Sui's object ownership enforces holder-only access at the VM level. An explicit `ctx.sender() == receipt.buyer` check contradicts the bearer model (ADR-005, H-1 fix in SECURITY-REVIEW-A.md) — it locks decryption to the original buyer forever, breaking receipt transfers and agent delegation.

---

## Multi-AI Coordination

This project was built with 3 AI instances:
- **Builder** — Move contracts, on-chain testing, deployment
- **Strategy** — TypeScript packages, PTB builders, composable flows
- **Coordinator** — MCP server, grant application, integration

When working on this codebase, check which layer your changes affect and whether other packages need updates.

---

## Testing Methodology — Aviation-Grade (DO-178B)

SweeFi uses **MC/DC (Modified Condition/Decision Coverage)** from DO-178B Level A (the same standard as Boeing avionics and SQLite). This is NOT optional for authorization-critical functions.

### MC/DC Rules

For any function with N boolean conditions that guards money or authorization:

1. **Happy path test** — all N conditions TRUE, function succeeds
2. **N isolation tests (MC-1 through MC-N)** — each flips exactly ONE condition to FALSE, all others TRUE. Proves each condition independently affects the outcome.
3. **BVA tests** — for every numeric boundary (caps, deadlines, amounts), test at exact limit (pass) and limit±1 (fail)
4. **Document the matrix** in the test file as comments

**Naming convention:**
```move
#[test] fun test_mcdc_hp_<function>() { ... }              // Happy path
#[test] fun test_mcdc_mc1_<function>_<condition>() { ... }  // C1=F
#[test] fun test_mcdc_bva_<function>_<boundary>() { ... }   // BVA
```

### Current MC/DC Coverage

| Module | Function | Conditions | MC/DC | BVA | Gaps |
|--------|----------|-----------|-------|-----|------|
| agent_mandate | `validate_and_spend` | 9 (C1-C9) | Complete | 10 tests | 0 |
| mandate | `validate_and_spend` | 6 (C1-C6) | Complete | 6 tests | 0 (MC-1 fixed) |
| prepaid | `claim` | 6 (C1-C6) | Complete | 4 tests | 0 (MC-2 fixed) |
| escrow | `refund` | 4 (C1-C4) | Complete | 2 tests | C1 unreachable (linear types) |
| stream | `claim` | ~5 | **TODO** | **TODO** | — |
| payment | `pay` | ~3 | **TODO** | **TODO** | — |
| admin | all guards | ~2-3 each | **TODO** | **TODO** | 5 tests exist, no matrix |

### Formal Verification

- **TLA+**: 6 modules formally specified (escrow, stream, prepaid, agent_mandate, mandate, admin). 27 safety invariants, 14 liveness properties, 39 adversarial scenarios — all verified. See `tla/VERIFICATION-REPORT.md`.
- **INVARIANTS.md**: 10 formally proven safety/liveness properties with full proofs. See `projects/sweefi-project/INVARIANTS.md`.

---

## Audit History

Audits are performed as "AI council wave" reviews — fresh-eyes analysis with no anchoring bias from previous passes. See SPEC.md "Security Audit Policy" section for full methodology.

### Wave 1 — Feb 2026 (AI Council, Move Contracts)

**Scope**: All 10 Move source files (~3,583 lines)
**Result**: 0 Critical, 3 High, 4 Medium, 4 Low, 4 Info (15 total findings)

**HIGH findings — all fixed in V8:**

| ID | Module | Finding | Fix |
|----|--------|---------|-----|
| H1 | `agent_mandate.move` | `validate_and_spend()` called `is_id_revoked()` without verifying `registry.owner == mandate.delegator` — rogue delegate could bypass revocation kill switch by passing empty registry they own | Added `mandate::registry_owner()` accessor; added ownership assertion before revocation check |
| H2 | `mandate.move` | `remaining()` panics when `max_total` lowered below `total_spent` — Move u64 subtraction aborts on underflow | Added saturation guard: `if (total_spent >= max_total) { 0 } else { max_total - total_spent }` |
| H3 | `stream.move` | Both min- and max-timeout violations used `ETimeoutTooShort` — upper bound had no distinct error code | Added `ETimeoutTooLong: u64 = 111`; changed upper-bound assertion |

**Adversarial audit (SECURITY-REVIEW-A.md) — same session:**

| ID | Module | Finding | Fix |
|----|--------|---------|-----|
| H-1 | `seal_policy.move` | `check_policy` checked `ctx.sender() == receipt_buyer`, locking decrypt rights to original buyer forever — breaking bearer model (ADR-005) and agent delegation (ADR-001) | Removed sender check; Sui ownership model enforces holder-only access |

**MEDIUM findings — pre-mainnet (not blocking testnet):**
- `prepaid.move`: u64::MAX cap creates dead-end in `claim()` (no way to distinguish "cap hit" from "overflow")
- `identity.move`: `total_volume` u64 can overflow on high-volume agents
- `prepaid.move` + `stream.move`: `top_up()` doesn't enforce the same MIN_DEPOSIT minimum as `create()`

**Test fixture debt discovered during wave (38 pre-existing failures):**
- Root cause: `MIN_DEPOSIT = 1_000_000` added as V8 security fix without updating test fixtures
- All fixtures used 10_000 / 5_000 / 1_000 deposits that predated the constant
- Files fixed: `escrow_tests.move`, `prepaid_tests.move`, `stream_tests.move`, `seal_policy_tests.move`
- All 180 Move tests pass post-fix

### Facilitator V8 changes (Feb 2026, same session)

| Change | File | Description |
|--------|------|-------------|
| `FEE_RECIPIENT` env var | `config.ts` | Optional — forwarded to `/.well-known/s402-facilitator`; feeRecipient is encoded in each s402 header; facilitator doesn't need to collect fees |
| `RATE_LIMIT_MAX_TOKENS` | `config.ts` | Token-bucket max capacity (default: 100). Was hardcoded. |
| `RATE_LIMIT_REFILL_RATE` | `config.ts` | Tokens/second refill rate (default: 10). Was hardcoded. |
| `/.well-known/s402-facilitator` | `routes.ts` | New endpoint — describes facilitator (who settles). Distinct from `/.well-known/s402.json` (resource server). Used by ecosystem tooling for discovery. |
| API_KEYS 16-char minimum | `config.ts` | Zod validates each API key individually after comma-split. Short keys abort server startup. |

### Facilitator API surface review + fixes (Feb 2026, teaching session)

Expert panel (5 domains) + skeptic agent reviewed the 6-endpoint API. Three true positives
fixed, two false positives confirmed, several proposals rejected. See ADR-008 for the full
decision log. New endpoints and middleware added:

| Change | File | Description |
|--------|------|-------------|
| `GET /ready` | `app.ts` | Readiness probe — checks scheme registration AND pings Sui RPC (3s timeout). Returns 503 if either fails. Distinct from `/health` (liveness). |
| `GET /settlements` | `routes.ts` | Per-key settlement history with pagination (`?limit`, `?offset`) and `dataRetainedSince` (server start time). Returns data for calling key only — not fleet-wide. |
| `src/middleware/dedup.ts` | new file | Payload dedup for `/settle` + `/s402/process`. Solves network-timeout reliability: if HTTP response is lost after Sui broadcast, retry returns cached `{ success: true }` with `X-Idempotent-Replay: true` instead of 500. Key = SHA-256(apiKey + canonicalBody). TTL = 60s. In-memory Phase 1. |
| `CHANGELOG.md` | new file | Per-package changelog (Keep a Changelog format, matching s402). |
| `docs/adr/008-facilitator-api-gaps.md` | new file | Full decision log for above changes. |

**Facilitator test count**: 37 → 63 (all passing, zero type errors)

**Key non-obvious findings from skeptic review:**
- `/stats` aggregate endpoint was dropped — any API key holder seeing total key count = competitor intelligence leak
- Dedup key must include apiKey — body-only key causes cross-tenant cache collisions (CustomerA gets CustomerB's receipt)
- Hono body stream concern was a false positive — `c.req.json()` uses internal `bodyCache`; safe to call in middleware and handler
- Blockchain-level idempotency (Sui rejects duplicate signed tx) means dedup is a reliability improvement, not a safety requirement

### Wave 2 — Mar 2026 (Pre-Publication Security Audit, R1+R2 dual-team)

**Scope**: Full codebase — 10 Move modules + 10 TS packages. Two independent agent teams (R1, R2) to eliminate anchoring bias.
**Result**: 87% false positives filtered. 6 true positives fixed. 4 design decisions documented.

**Fixes applied:**

| ID | Layer | Finding | Fix |
|----|-------|---------|-----|
| F-14 | Move | `agent_mandate` error codes (500s) collided with `admin` (500s) | Renumbered to 550-series. Updated MCP error map + tests. |
| F-15 | TS | Non-exact scheme facilitators accepted events without packageId verification (spoofable) | `packageId` now required in constructor; graceful degradation in facilitator.ts |
| F-16 | TS | `/settle` and `/s402/process` double-counted gas sponsorship (recordSponsored called in both /sponsor and /settle) | Removed duplicate tracking from /settle and /s402/process |
| F-17 | TS | TOCTOU race in gas sponsor rate limiting (canSponsor then recordSponsored with async work between) | Added atomic `tryConsume()` to IGasSponsorTracker; /sponsor uses it |
| F-18 | TS | Facilitator error responses leaked internal error messages (OWASP info disclosure) | Catch blocks now log server-side, return generic errors to clients |
| F-19 | Move+TS | AgentMandate max_total=0 footgun (meant "unlimited" in AgentMandate but "zero budget" in base Mandate) | **Semantic fix**: removed all `if (X > 0)` guards — 0 now unconditionally means zero budget. u64::MAX for unlimited. TS SDK throws on L2+ with maxTotal=0. |

**Documented design decisions (NOT fixed — intentional):**

| ID | Finding | Decision |
|----|---------|----------|
| D-14 | `payment.move` allows self-payment (sender == recipient) | By design — restricting on immutable contract risks breaking composability. Facilitator validates off-chain. |
| ~~D-15~~ | ~~`max_total=0` means unlimited~~ | **FIXED in F-19** — 0 = zero budget everywhere. u64::MAX = unlimited. |
| D-16 | `x-forwarded-for` spoofable for unauthenticated rate limiting | Settlement endpoints use API key (not spoofable). XFF only for unauthenticated /health etc. |
| D-17 | `calculate_fee_min()` can return fee > amount | Documented in tests as "AUDIT FINDING 1". Immutable contract — TS wrapper validates. |

### Wave 3 — Mar 2026 (Post-Fix Hardening Audit)

**Scope**: Move contracts only — fresh team after Wave 2 contract changes.
**Result**: 2 hardening improvements applied (error quality + overflow safety). Most findings were false positives from auditor assuming Solidity wrapping-overflow model instead of Move's abort-on-overflow.

**Fixes applied:**

| ID | Layer | Finding | Fix |
|----|-------|---------|-----|
| F-20 | Move | Cap checks in `agent_mandate` and `mandate` could abort with generic `ARITHMETIC_ERROR` instead of structured error codes at u64 boundary | u128 intermediate arithmetic for all cap checks (daily, weekly, lifetime). Fires `EDailyLimitExceeded`/`EWeeklyLimitExceeded`/`ETotalLimitExceeded` instead of `ARITHMETIC_ERROR`. |
| F-21 | Move | `stream.move` timeout check `now_ms >= last_activity + timeout` could abort with `ARITHMETIC_ERROR` if `last_activity + timeout` overflows u64 | Rearranged to `now_ms - last_activity >= timeout`. Safe: Clock is monotonic so `now_ms >= last_activity`. |

---

## Safety Invariants

SweeFi has **10 formally proven invariants** in `INVARIANTS.md`. Read these before modifying Move contracts or payment flows:

| ID | Property | Type | What it protects |
|----|----------|------|------------------|
| P1 | Prepaid solvency | Safety | Agent never loses more than deposited |
| P2 | Dispute bounds | Safety | Fraud proofs must reference current batch only (F1 fix verified) |
| P3 | Mandate spending | Safety | Structural enforcement at Move consensus, not LLM behavior |
| P4 | No double settlement | Safety | Each payment produces at most one on-chain receipt |
| P5 | Escrow termination | Liveness | Every escrow eventually resolves (no permanent fund lock) |
| P6 | Stream budget cap | Safety | Stream never exceeds max_amount regardless of tick timing |
| P7 | PTB atomicity | Safety | No orphaned verify-without-settle states |
| P8 | SEAL content gating | Safety | Content inaccessible until payment receipt exists on-chain |
| P9 | Facilitator non-custodial | Safety | Facilitator is a relay, cannot forge or redirect payments |
| P10 | Withdrawal delay | Safety | Safe but has UX gap when dispute_window > withdrawal_delay |

**If you modify `prepaid.move`, `stream.move`, `escrow.move`, or `mandate.move`, re-verify the relevant invariant.**

---

## Related Files

- **INVARIANTS.md** — Formal safety proofs (Lamport-style, 10 properties)
- **SPEC.md** — Full specification, vision, timeline
- **BATTLE-PLAN.md** — Competitive strategy vs BEEP
- **GRANT-APPLICATION.md** — Sui DeFi Moonshots grant application
- **contracts/DEMO.md** — Demo script with MCP tools
- **docs/SDK-ARCHITECTURE-RESTRUCTURE.md** — Architecture restructure plan (COMPLETE)
- **docs/adr/001** — Composable PTB architecture decision (entry vs public; SEAL flow)
- **docs/adr/003** — Fee rounding & u128 math (Cetus lesson)
- **docs/adr/004** — AdminCap & two-tier pause model
- **docs/adr/005** — Receipt transferability & SEAL bearer model
- **docs/adr/006** — Owned vs shared object model
- **docs/adr/007** — Prepaid trust model (v0.1 economic → v0.2 signed receipts → v0.3 TEE)
- **docs/adr/008** — Facilitator API gaps: /ready, /settlements, dedup middleware — decisions + rejected alternatives
- **SECURITY-REVIEW-A.md** — Adversarial Move contract audit (all findings + fixes)
- **packages/sui/ADR-001.md** — PTB composability detail
