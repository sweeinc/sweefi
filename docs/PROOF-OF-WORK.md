# SweePay Proof of Work

Last verified: 2026-02-14

## Verification Commands

```bash
# TypeScript workspace tests (offline-safe default lane)
pnpm test

# Move contract tests
cd contracts && sui move test
```

## Verified Test Counts (Current)

- TypeScript tests: 417 passing
  - `@sweepay/core`: 54
  - `@sweepay/sui`: 123
  - `@sweepay/sdk`: 39
  - `@sweepay/facilitator`: 41
  - `@sweepay/mcp`: 36
  - `@sweepay/widget`: 6
  - `s402`: 118
- Move tests: 226 annotations (158 positive + 68 negative-path)

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

- Package ID: `0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5`
- Explorer: <https://suiscan.xyz/testnet/object/0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5>

