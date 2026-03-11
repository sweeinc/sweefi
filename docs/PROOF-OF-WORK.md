# SweeFi Proof of Work

Last verified: 2026-03-10

## Verification Commands

```bash
# TypeScript workspace tests (offline-safe default lane)
pnpm -r test

# Move contract tests
cd contracts && sui move test
```

## Verified Test Counts

- TypeScript tests: **1,143 passing**
  - `@sweefi/sui`: 465
  - `@sweefi/cli`: 238
  - `@sweefi/mcp`: 222
  - `@sweefi/facilitator`: 91
  - `@sweefi/ap2-adapter`: 52
  - `@sweefi/solana`: 40
  - `@sweefi/ui-core`: 13
  - `@sweefi/react`: 12
  - `@sweefi/vue`: 10
  - `@sweefi/server`: 0 (integration-only tests — no offline unit tests)
- Move tests: **426 functions** (all passing)
- **Grand total: 1,569 tests**
- **Hardening audit**: [HARDENING-AUDIT-2026-03-10.md](HARDENING-AUDIT-2026-03-10.md) — DO-178B MC/DC, mutation testing, metamorphic verification

## Live Testnet Transactions (v11 — current package)

All transactions below call the v11 Move contracts at `0xb83e5036...9ac5`.

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

**v11 (live — 11th testnet deploy, auto-unpause + MC/DC):**
- Package ID: `0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5`
- AdminCap: `0xdba70844f06c46dd4f4a331bcf9ffa234cfd1b9c9d7449719a5311112fa946dc`
- ProtocolState: `0x75f4eef7ad9cdffda4278c9677a15d4993393e16cc901dc2fe26befe9e79808b`
- UpgradeCap: `0xb160234f12c12e4c1a98010569e18fcd9a444a5eec3c15e3b2eedb0f691d000f`
- Explorer: <https://suiscan.xyz/testnet/object/0xb83e50365ba460aaa02e240902a40890bec88cd35bd2fc09afb6c79ec8ea9ac5>
- Modules: `payment`, `stream`, `escrow`, `seal_policy`, `mandate`, `agent_mandate`, `prepaid`, `admin`, `math`, `identity`
