# SweePay — AGENTS.md (Codebase Manual)

> For any AI agent (Claude Code, Codex, Gemini CLI) working on this project.

## Project Overview

**SweePay** is open-source agentic payment infrastructure for Sui.
- Monorepo with 6 TS packages + Move smart contracts
- Applying for Sui DeFi Moonshots program ($500K grant)
- Competing with BEEP (justbeep.it) — proprietary alternative
- 396 total tests (312 TypeScript + 84 Move)

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
│   ├── core/                     # Shared types, client factories, s402 protocol, constants (54 tests)
│   ├── sui/                      # 18 PTB builders for all contract ops (123 tests)
│   ├── sdk/                      # Client + server SDK, 3-line integration (39 tests)
│   ├── facilitator/              # Self-hostable payment verification (41 tests)
│   ├── mcp/                      # MCP server, 16 AI agent tools (36 tests)
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
2. **s402 protocol**: Sui-native payment protocol (HTTP 402 based, x402 wire-format compatible)
3. **Hono over Express**: Lighter, edge-compatible
4. **tsdown bundler**: NOT tsup (tsup is EOL)
5. **Composable PTBs**: `buildPayAndProveTx()` combines pay + receipt transfer atomically (see ADR-001 in packages/sui/)
6. **MCP-native**: 16 tools registered on MCP server for AI agent discovery
7. **dApp Kit for wallets**: No vendor lock-in

## Key Dependencies

- `@mysten/sui@^1.20.0` — Sui TypeScript SDK
- `@modelcontextprotocol/sdk@^1.9.0` — MCP server SDK
- `@x402/core@^2.3.0` — x402 protocol types
- `hono@^4.0.0` — Web framework (facilitator)
- `zod@^3.22.0` — Runtime validation

## MCP Server (16 Tools)

The MCP package registers 16 tools: 4 read-only + 12 transaction.

Read-only: `check_balance`, `check_payment`, `get_receipt`, `supported_tokens`
Transaction: `pay`, `pay_and_prove`, `create_invoice`, `pay_invoice`, `start_stream`, `stop_stream`, `recipient_close_stream`, `create_escrow`, `release_escrow`, `refund_escrow`, `dispute_escrow`

All tool names prefixed with `sweepay_`. Transaction tools require `SUI_PRIVATE_KEY` env var.

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
