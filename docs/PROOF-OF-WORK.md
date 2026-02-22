# SweeFi Proof of Work

Last verified: 2026-02-21

## Verification Commands

```bash
# TypeScript workspace tests (offline-safe default lane)
pnpm -r test

# Move contract tests
cd contracts && sui move test
```

## Verified Test Counts (Current — post V8 audit)

- TypeScript tests: **382 passing**
  - `@sweefi/ui-core`: 13
  - `@sweefi/server`: 0 (integration-only tests — no offline unit tests)
  - `@sweefi/sui`: 189
  - `@sweefi/vue`: 10
  - `@sweefi/react`: 12
  - `@sweefi/facilitator`: 37
  - `@sweefi/mcp`: 79
  - `@sweefi/cli`: 42
- Move tests: **180 functions** (all passing as of V8 security fixes)

> **Note**: V8 Move changes are code-complete locally. V7 (`0x242f...54c3d`) is the current live testnet package. V8 awaits deployment by Danny.

## Live Testnet Transactions

| Transaction | Type | Explorer Link |
|------------|------|---------------|
| Direct payment | `payment::pay` | [`7YbMKa4Ljs...`](https://suiscan.xyz/testnet/tx/7YbMKa4LjsFwxBQtGz92LnJ5XmhzNEvWXahxcnBct9ne) |
| Escrow creation | `escrow::create` | [`bnB9Lu913j...`](https://suiscan.xyz/testnet/tx/bnB9Lu913jtxZmnz9McFXDwMBVJx5yRTgL9LEhLHgei) |
| Package upgrade (v4) | `sui::package::upgrade` | [`935ZCd5ezU...`](https://suiscan.xyz/testnet/tx/935ZCd5ezU2Na6vcWi4nkDs2ckXXVNWdC9Xynx5rzxnY) |
| Package upgrade (v5) | `sui::package::upgrade` | [`FcnWC5vmQQ...`](https://suiscan.xyz/testnet/tx/FcnWC5vmQQfmQG8T3FdTRQSzFtKJacZ1hX8g48vnR5eU) |
| Atomic pay-and-prove | `payment::pay` + `transferObjects` | [`EX98DsYGdf...`](https://suiscan.xyz/testnet/tx/EX98DsYGdfv5uAeBKkkacvSbrdj2sy4tgqxChCTYi8b1) |
| Stream create + close | `stream::create` + `stream::close` | [`BLcUBKBpnS...`](https://suiscan.xyz/testnet/tx/BLcUBKBpnSkSn2KTQQ1rq5eCiqxo7xn1VponUX98WzpN) |

## Live Objects

| Object | Type | Explorer Link |
|--------|------|---------------|
| StreamingMeter | `stream::StreamingMeter<SUI>` | [`0x9edbb5...`](https://suiscan.xyz/testnet/object/0x9edbb545e68c7a99d6eb81acedcb1d88c2f05d6177ae86b693d74daa587b6ce2) |
| Escrow | `escrow::Escrow<SUI>` | [`0x7e4447...`](https://suiscan.xyz/testnet/object/0x7e4447a8574182f880f0bf76d1db9da7d8a14ee867e414525a205a3a34de41ff) |
| PaymentReceipt | `payment::PaymentReceipt` | [`0xaabfae...`](https://suiscan.xyz/testnet/object/0xaabfaec0ab04d2c7d403dc23a26e1089d3bb9f4291636107abdbb51bf9728e7e) |

## Current Testnet Package

**V7 (live):**
- Package ID: `0x242f22b9f8b3d77868f6cde06f294203d7c76afa0cd101f388a6cefa45b54c3d`
- AdminCap: `0x2094ced6e92ce7632ae40bf1292f272cf4caa7c3ab110f2edbfa9f4fdafd119b`
- ProtocolState: `0xbfe77423523556fe038a3e83ad4e5be2eac03bc28c453f7345eef7636a547b09`
- UpgradeCap: `0x77c484495113c9fbfe9bce9b482f6974e83402ac65853a99c6273de23f9672ad`
- Explorer: <https://suiscan.xyz/testnet/object/0x242f22b9f8b3d77868f6cde06f294203d7c76afa0cd101f388a6cefa45b54c3d>

**V8 (pending deploy):**
- Package ID: **TBD** — Danny runs `sui client publish --gas-budget 500000000` in `contracts/`
- Includes: 3 HIGH security fixes (revocation bypass, remaining() underflow, ETimeoutTooLong)
