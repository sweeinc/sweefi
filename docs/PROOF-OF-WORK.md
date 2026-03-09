# SweeFi Proof of Work

Last verified: 2026-03-08

## Verification Commands

```bash
# TypeScript workspace tests (offline-safe default lane)
pnpm -r test

# Move contract tests
cd contracts && sui move test
```

## Verified Test Counts

- TypeScript tests: **809 passing**
  - `@sweefi/sui`: 257
  - `@sweefi/cli`: 238
  - `@sweefi/mcp`: 124
  - `@sweefi/facilitator`: 63
  - `@sweefi/ap2-adapter`: 52
  - `@sweefi/solana`: 40
  - `@sweefi/ui-core`: 13
  - `@sweefi/react`: 12
  - `@sweefi/vue`: 10
  - `@sweefi/server`: 0 (integration-only tests — no offline unit tests)
- Move tests: **264 functions** (all passing)
- **Grand total: 1,073 tests**

## Live Testnet Transactions (v10 — current package)

All transactions below call the v10 Move contracts at `0x04421d...a820ef`.

| Transaction | Type | Explorer Link |
|------------|------|---------------|
| Direct payment | `payment::pay` | [`Gts9F3gX...`](https://suiscan.xyz/testnet/tx/Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK) |
| Stream creation | `stream::create` | [`GDo8g5Yu...`](https://suiscan.xyz/testnet/tx/GDo8g5Yu1X1zCdaLTtEVCqxeWJqkDDyoHjdGP5TLvkhf) |
| Escrow creation | `escrow::create` | [`EcYFG3FT...`](https://suiscan.xyz/testnet/tx/EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR) |

## Live Objects

| Object | Type | Explorer Link |
|--------|------|---------------|
| StreamingMeter | `stream::StreamingMeter<SUI>` | [`0xbd8da3...`](https://suiscan.xyz/testnet/object/0xbd8da3c7a69d1d10ee4dcada29c39272f1801349fce03fbb679d94ee231f08a3) |
| Escrow | `escrow::Escrow<SUI>` | [`0xe13315...`](https://suiscan.xyz/testnet/object/0xe1331575df1a93fe11ed1758ee7110c0a581f98d7ff889d40e23b6fa2a67b531) |
| PaymentReceipt | `payment::PaymentReceipt` | [`0xffd2c8...`](https://suiscan.xyz/testnet/object/0xffd2c8e26ebd0a69ad89802eb6a57ad92da2b5690befd529b2a96d99634db00f) |

## Current Testnet Package

**v10 (live — 10th testnet deploy):**
- Package ID: `0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef`
- AdminCap: `0xc54ec6846273170565e3eec1836bb48363413fb4b7b2592ee342cc3d0363f5e5`
- ProtocolState: `0x9eae2fa9f298927230d8fdf2e525cab0f7894874d94ecedec4df2ae7a4f3df15`
- UpgradeCap: `0x2472fdc1bbfe8958d776bf80baa7e7e50fcc146f4c4c91cdd61f0e2970ba98e9`
- Explorer: <https://suiscan.xyz/testnet/object/0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef>
- Modules: `payment`, `stream`, `escrow`, `seal_policy`, `mandate`, `agent_mandate`, `prepaid`, `admin`, `math`, `identity`
