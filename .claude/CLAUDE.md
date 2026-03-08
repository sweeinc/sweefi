# SweeFi — Claude Code Project Instructions

## Quick Orient (<10 seconds)

- **What**: Agentic payment SDK for Sui. s402 protocol (HTTP 402). 10 TS packages + 10 Move modules.
- **Full codebase manual**: Read `AGENTS.md` (root) BEFORE touching code.
- **Current state**: See `STATUS.md` for what's deployed, working, next, and blocked.

## Before Any Code Change

1. Read `AGENTS.md` — especially "What NOT to Do" and "Common Pitfalls"
2. Check `docs/adr/` if touching a load-bearing design decision
3. Verify green: `pnpm -r build && pnpm typecheck && pnpm test`

## Critical Boundaries

- **s402 is chain-agnostic. @sweefi/sui is chain-specific.** NEVER put Sui logic in the s402 package.
- **Fee math uses micro-percent** (1,000,000 = 100%) on-chain, **basis points** (10,000 = 100%) on the wire. Convert via `bpsToMicroPercent()` in `packages/sui/src/ptb/assert.ts`.
- **`seal_approve` must NEVER check `ctx.sender()`.** Bearer receipt = access. See ADR-005.
- **All fee calculations** go through `math::calculate_fee()` with u128 intermediate. See ADR-003.

## Package Status

| Package | Status | Tests | Key Limitation |
|---------|--------|-------|----------------|
| `@sweefi/sui` | Beta | 252 | Core of everything |
| `@sweefi/server` | Beta | Integration-only | Hono middleware |
| `@sweefi/mcp` | Beta | 124 | 35 AI agent tools |
| `@sweefi/facilitator` | Beta | 57 | Docker-only, private |
| `@sweefi/cli` | Beta | 237 | — |
| `@sweefi/ui-core` | Beta | 13 | Framework-agnostic state machine |
| `@sweefi/vue` | Alpha | 10 | — |
| `@sweefi/react` | Alpha | 12 | — |
| `@sweefi/ap2-adapter` | Alpha | 52 | AP2 spec is v0.1 |
| `@sweefi/solana` | Stub | 40 | Exact-only. No prepaid/stream/escrow. |
| Move contracts | V8 local, V7 deployed | 246 | V8 not yet deployed to testnet |

## Key File Locations

| What | Where |
|------|-------|
| Deployed package IDs | `packages/sui/src/ptb/deployments.ts` |
| Coin type constants | `packages/sui/src/constants.ts` |
| Fee validation (TS) | `packages/sui/src/ptb/assert.ts` |
| Fee calculation (Move) | `contracts/sources/math.move` |
| s402 scheme registry | `packages/sui/src/s402/index.ts` |
| Facilitator env config | `packages/facilitator/src/config.ts` |
| PTB builder types | `packages/sui/src/ptb/types.ts` |
| ADR decisions | `docs/adr/001-009` |

## Do Not

- Install npm packages without asking Danny first
- Create or open PRs without asking Danny first
- Commit or push without Danny reviewing
- Put Sui-specific logic in the `s402` package
- Skip `pnpm typecheck` before reporting "done"
