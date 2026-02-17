# SweePay — AGENTS.md (Codebase Manual)

> For any AI agent (Claude Code, Codex, Gemini CLI) working on this project.

## Project Overview

**SweePay** is open-source agentic payment infrastructure for Sui.
- Monorepo with 8 TS packages + Move smart contracts
- Applying for Sui DeFi Moonshots program ($500K grant)
- Competing with BEEP (justbeep.it) — proprietary alternative
- 732 total tests (506 TypeScript + 226 Move)

## Repository Structure

```
sweepay-project/
├── contracts/                    # Move smart contracts (8 modules, 226 test annotations)
│   └── sources/
│       ├── payment.move          # Direct payments, invoices, receipts
│       ├── stream.move           # Streaming micropayments + budget caps
│       ├── escrow.move           # Time-locked escrow + arbiter disputes
│       ├── seal_policy.move      # SEAL integration (pay-to-decrypt)
│       ├── mandate.move          # Basic spending delegation, revocation
│       ├── agent_mandate.move    # L0-L3 progressive autonomy, lazy reset
│       ├── prepaid.move          # Deposit-based agent budgets, batch-claim
│       └── admin.move            # Emergency pause, admin capabilities
├── packages/
│   ├── s402-core/                # s402 protocol — HTTP 402 wire format, zero deps (207 tests)
│   ├── core/                     # Shared types, client factories, constants (54 tests)
│   ├── sui/                      # 18 PTB builders for all contract ops (114 tests)
│   ├── sdk/                      # Client + server SDK, 3-line integration (6 tests)
│   ├── facilitator/              # Self-hostable payment verification (37 tests)
│   ├── mcp/                      # MCP server, 30+5 AI agent tools (79 tests)
│   ├── cli/                      # CLI tool — wallet, pay, prepaid, mandates (42 tests)
│   └── widget/                   # Framework-agnostic checkout core + Vue adapter (6 tests)
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
pnpm -r --filter @sweepay/mcp test
pnpm -r --filter @sweepay/sui build
```

## Smart Contracts (Testnet v7)

Package ID: `0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5`

8 modules, all deployed, 226 Move test annotations passing (158 positive + 68 negative-path).

**Key design patterns:**
- All payment functions are `public` (composable in PTBs), not `entry`
- Receipts are owned objects (transferable, usable as SEAL conditions)
- Streams have permissionless recipient close (abandoned stream recovery)
- Escrows have permissionless deadline refund (no funds locked forever)
- `seal_policy::seal_approve()` is called in dry-run by SEAL key servers

**v5 security fixes:** `resume()` accrual theft vulnerability fixed via time-shift pattern (preserves pre-pause accrual). Escrow `description` length capped at 1024 bytes (state bloat prevention).

**v6 feature:** `create_with_timeout()` — configurable recipient_close timeout per-stream (1-day minimum, 7-day default). Uses Sui dynamic fields for backward compatibility — no struct change needed.

## Package Dependencies

```
@sweepay/mcp ──► @sweepay/sui ──► @sweepay/core
                                       ▲
@sweepay/sdk ──► @sweepay/core ────────┘
                       ▲
@sweepay/facilitator ──┘
```

## Architecture Decisions

1. **Sign-first model**: Client signs PTB, facilitator verifies + broadcasts
2. **s402 protocol**: Sui-native HTTP 402 payment protocol
3. **Hono over Express**: Lighter, edge-compatible
4. **tsdown bundler**: NOT tsup (tsup is EOL)
5. **Composable PTBs**: `buildPayAndProveTx()` combines pay + receipt transfer atomically (see ADR-001 in packages/sui/)
6. **MCP-native**: 30 tools (+ 5 opt-in) registered on MCP server for AI agent discovery
7. **dApp Kit for wallets**: No vendor lock-in

## Key Dependencies

- `@mysten/sui` — Sui TypeScript SDK (peerDep: `>=1.20.0 || ^2.0.0`)
- `@modelcontextprotocol/sdk@^1.26.0` — MCP server SDK
- `s402@^0.1.0` — s402 payment protocol core
- `hono@^4.0.0` — Web framework (facilitator)
- `zod@^3.22.0` — Runtime validation

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

All tool names prefixed with `sweepay_`. Transaction tools require `SUI_PRIVATE_KEY` env var.

## Packaging & Publishing Conventions

**Publish order** (workspace deps must publish first):
```
@sweepay/core → @sweepay/sui → @sweepay/mcp + @sweepay/sdk + @sweepay/facilitator
```

**Build tool**: `tsdown` (NOT tsup — tsup is EOL). Config in each package's `tsdown.config.ts`.

**Source maps**: INCLUDE in published packages. MCP servers and facilitators run as subprocesses — stack traces need readable paths. The size overhead is trivial (~164KB for MCP). The `files` array should be `["dist", "README.md", "LICENSE"]` which includes `.map` files.

**CLI/library split pattern** (applies to `@sweepay/mcp`, `@sweepay/facilitator`):
- `src/index.ts` — Pure re-exports only. No side effects. Imported as a library.
- `src/cli.ts` — Shebang + `main()` + stdio transport. Used by `bin` in package.json.
- ESM has no `require.main === module`. Calling `main()` at module level in `index.ts` would start a server on every `import`.

**peerDependencies**: `@mysten/sui` is a peer dep (`>=1.20.0 || ^2.0.0`), not a direct dep. This avoids duplicate SDK instances when consumers also use the Sui SDK.

**prepublishOnly gate**: Every package must have `"prepublishOnly": "pnpm run build && pnpm run typecheck && pnpm run test"`. This ensures nothing publishes broken.

**Version constant**: `server.ts` has a `VERSION` constant that must match `package.json`. The prepublishOnly script catches drift at publish time (typecheck + test).

**workspace:\* protocol**: `pnpm publish` automatically rewrites `workspace:*` to real versions. NEVER use `npm publish` — it would publish literal `workspace:*` strings.

## Common Pitfalls

1. **USDC address differs by network**: Check `@sweepay/core` COIN_TYPES constant
2. **Sign-first means no execution on client side**: SDK uses `signTransaction()` not `signAndExecuteTransaction()`
3. **Buffer doesn't exist in browser**: Use `toBase64`/`fromBase64` from @mysten/sui/utils
4. **Escrow export is plural**: `registerEscrowTools` (4 tools), not `registerEscrowTool`
5. **Integration dry-run tests are opt-in live lane**: run `pnpm test:live` (requires network; default `pnpm test` is offline-safe)

## Multi-AI Coordination

This project was built with 3 AI instances:
- **Builder** — Move contracts, on-chain testing, deployment
- **Strategy** — TypeScript packages, PTB builders, composable flows
- **Coordinator** — MCP server, grant application, integration

When working on this codebase, check which layer your changes affect and whether other packages need updates.

## Related Files

- **SPEC.md** — Full specification, vision, timeline
- **BATTLE-PLAN.md** — Competitive strategy vs BEEP
- **GRANT-APPLICATION.md** — Sui DeFi Moonshots grant application
- **contracts/DEMO.md** — Demo script with MCP tools
- **packages/sui/ADR-001.md** — Composable PTB architecture decision
