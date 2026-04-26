# SweeFi — Current Status

> Last updated: 2026-04-16

## Deployment State

- **Sui Testnet**: `0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5` (live, v11 deploy — auto-unpause + MC/DC)
- **Mainnet**: Not yet deployed
- **SEAL mainnet**: Blocked on Mysten Labs publishing key server addresses
- **Facilitator**: https://s402.sweefi.com (fly.io, all 5 Sui schemes live)
  - Wallet: `0x21f1a6d13101fafa2fab7d62a13a2c920867ae13e0c26e3c4317951280147df0` (needs funding ~0.5 SUI)
  - Fee: 0.5% (50 bps)
  - CI/CD: Auto-deploy on push to `main` (paths: `packages/facilitator/**`, `packages/sui/**`, `packages/solana/**`)

## What Is Working (Verified on Testnet)

- **Demo 1** (direct payment via `payment::pay`): PASSED on v11
  - TX: [`Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK`](https://suiscan.xyz/testnet/tx/Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK) — 10K MIST + 5% fee, PaymentReceipt minted
- **Demo 2** (streaming via `stream::create`): PASSED on v11
  - TX: [`GDo8g5Yu1X1zCdaLTtEVCqxeWJqkDDyoHjdGP5TLvkhf`](https://suiscan.xyz/testnet/tx/GDo8g5Yu1X1zCdaLTtEVCqxeWJqkDDyoHjdGP5TLvkhf) — 1M MIST deposit, 300 MIST/sec, StreamingMeter created
- **Demo 3** (escrow via `escrow::create`): PASSED on v11
  - TX: [`EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR`](https://suiscan.xyz/testnet/tx/EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR) — 1M MIST escrow, Escrow object created
- All 10 TS packages build and typecheck
- **1,349 TypeScript tests** passing across 10 packages
- **426 Move test functions** passing (10 modules)
- MCP server: 35 tools, all tested
- Facilitator service: verify, settle, process, discovery, metering
- s402 npm package published (v0.2.2) with 133 conformance test vectors
- **npm packages updated (April 16, 2026)**:
  - `@sweefi/sui@0.4.1` — explicit event field validation (A+ hardening)
  - `@sweefi/solana@0.2.0` — Solana programs scaffolding
- **CI/CD automated**: Changesets workflow for npm publishing, fly.io auto-deploy
- **Solana schemes (April 16, 2026)**: All 4 schemes (upto, stream, escrow, prepaid) have full TypeScript implementations with event-based facilitator verification. Anchor programs compile. See DAN-327 for remaining work.

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

- `@sweefi/solana` has all 4 schemes implemented (upto, stream, escrow, prepaid) but settlement requires Anchor IDL generation (blocked by toolchain: Anchor CLI 0.31+ needed). See DAN-327.
- Identity module only tracks PaymentReceipt (not escrow/stream/prepaid receipts)
- zkLogin not supported in facilitator signature verification
- Gas sponsorship is exact-scheme only (stream/escrow/prepaid use shared Move objects)

## Test Counts (Source of Truth)

| Package | Tests |
|---------|-------|
| `@sweefi/sui` | 669 |
| `@sweefi/cli` | 238 |
| `@sweefi/mcp` | 222 |
| `@sweefi/facilitator` | 91 |
| `@sweefi/ap2-adapter` | 52 |
| `@sweefi/solana` | 42 |
| `@sweefi/ui-core` | 13 |
| `@sweefi/react` | 12 |
| `@sweefi/vue` | 10 |
| **TypeScript total** | **1,349 passing** |
| Move contracts | 426 |
| **Grand total** | **1,775 passing** |
