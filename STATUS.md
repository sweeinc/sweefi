# SweeFi — Current Status

> Last updated: 2026-03-08

## Deployment State

- **Sui Testnet**: `0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef` (live, v10 deploy)
- **Mainnet**: Not yet deployed
- **SEAL mainnet**: Blocked on Mysten Labs publishing key server addresses

## What Is Working (Verified on Testnet)

- **Demo 1** (agent-pays-API direct settlement): PASSED on testnet
  - TX proof: `FdhFb6NKPB5q3VJYNR3JVyAkhz64Asem22CJ4ZrGvpKo` (1K) + `2QrArwjhk3SjHxE1jsvvw5KrtPCdzujgVYjq6RkaDvNv` (5K)
- **Demo 2** (facilitator settlement with fee split): PASSED on testnet
  - TX proofs: `72TyN5ZvE4st8EbzAUr1MLr5uWkTiinYQauZNEDLDoYg` (10K) + `3Y9SajrbF8vPS5oW4FnwztZM1jpMjnRq8GKhr667gQVZ` (50K)
- All 10 TS packages build and typecheck
- **809 TypeScript tests** passing across 10 packages
- **264 Move test functions** passing (10 modules)
- MCP server: 35 tools, all tested
- Facilitator service: verify, settle, process, discovery, metering
- s402 npm package published (v0.2.2) with 133 conformance test vectors

## What Is Next

1. **Moonshots DeFi grant submission**: Self-imposed mid-March target
2. **Marketing launch**: Twitter threads, blog, Discord, HN, Reddit
3. **Re-run Demo 2 against v10**: Update TX proofs
4. **Mainnet deployment**: After grant + SEAL key server

## What Is Blocked

| Item | Blocker | Owner |
|------|---------|-------|
| SEAL mainnet | Mysten Labs key server publication | External |

## Known Limitations

- `@sweefi/solana` is exact-only (prepaid/stream/escrow need Anchor programs)
- Identity module only tracks PaymentReceipt (not escrow/stream/prepaid receipts)
- zkLogin not supported in facilitator signature verification
- Gas sponsorship is exact-scheme only (stream/escrow/prepaid use shared Move objects)

## Test Counts (Source of Truth)

| Package | Tests |
|---------|-------|
| `@sweefi/sui` | 257 |
| `@sweefi/cli` | 238 |
| `@sweefi/mcp` | 124 |
| `@sweefi/facilitator` | 63 |
| `@sweefi/ap2-adapter` | 52 |
| `@sweefi/solana` | 40 |
| `@sweefi/ui-core` | 13 |
| `@sweefi/react` | 12 |
| `@sweefi/vue` | 10 |
| **TypeScript total** | **809 passing** |
| Move contracts | 264 |
| **Grand total** | **1,073 passing** |
