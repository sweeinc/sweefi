# SweeFi — Current Status

> Last updated: 2026-03-04

## Deployment State

- **Testnet V7**: `0x242f22b9f8b3d77868f6cde06f294203d7c76afa0cd101f388a6cefa45b54c3d` (live, deployed)
- **Testnet V8**: Code complete, audited (V8-FINAL-AUDIT + V8-POST-FIX-AUDIT), **NOT YET DEPLOYED** (needs Danny to run `sui client publish`)
- **Mainnet**: Not yet deployed
- **SEAL mainnet**: Blocked on Mysten Labs publishing key server addresses

## What Is Working (Verified on Testnet)

- **Demo 1** (agent-pays-API direct settlement): PASSED on testnet
  - TX proof: `7P8wDGJ7aRd6twFUfC2HMiRHnuMAa9Dq1DBfNJqWJaiN`
- All 10 TS packages build and typecheck
- **603 TypeScript tests** passing across 9 packages (612 total incl. 7 skipped + 2 todo)
- **246 Move test functions** passing (10 modules)
- MCP server: 35 tools, all tested
- Facilitator service: verify, settle, process, discovery, metering
- s402 npm package published (v0.2.0) with 133 conformance test vectors

## What Is Next

1. **Demo 2**: Facilitator-as-a-service settlement (validates fee splitting, multi-party settlement)
2. **V8 testnet deployment**: Needs Danny's keypair
3. **Moonshots DeFi grant submission**: Self-imposed mid-March target

## v0.2 Features (Just Completed)

- Fee enforcement in exact scheme (two-branch balance-change verification)
- Mandate integration (validate_and_spend in client PTBs)
- Gas sponsorship (facilitator co-signing, configurable budget cap, per-key rate limiting)
- Defense-in-depth: feeBps validation, zero-budget bypass fix, gas tracker

## What Is Blocked

| Item | Blocker | Owner |
|------|---------|-------|
| V8 testnet deployment | Needs keypair + `sui client publish` | Danny |
| SEAL mainnet | Mysten Labs key server publication | External |
| Demo 2 run | V8 deploy (for fee split verification on-chain) | Danny |

## Known Limitations

- `@sweefi/solana` is exact-only (prepaid/stream/escrow need Anchor programs)
- Identity module only tracks PaymentReceipt (not escrow/stream/prepaid receipts)
- zkLogin not supported in facilitator signature verification
- Gas sponsorship is exact-scheme only (stream/escrow/prepaid use shared Move objects)
- Gas sponsor rate limiting uses post-record only (bounded race window, ~$1 worst case)

## Test Counts (Source of Truth)

| Package | Tests |
|---------|-------|
| `@sweefi/sui` | 252 |
| `@sweefi/mcp` | 124 |
| `@sweefi/facilitator` | 57 |
| `@sweefi/ap2-adapter` | 52 |
| `@sweefi/cli` | 43 |
| `@sweefi/solana` | 40 |
| `@sweefi/ui-core` | 13 |
| `@sweefi/react` | 12 |
| `@sweefi/vue` | 10 |
| **TypeScript total** | **603 passing** (612 incl. skipped/todo) |
| Move contracts | 246 |
| **Grand total** | **849 passing** (858 incl. skipped/todo) |
