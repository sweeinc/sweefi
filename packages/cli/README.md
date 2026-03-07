# @sweefi/cli

CLI for AI agent payments on Sui — pay, stream, escrow, and manage mandates from the terminal.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem — open-source agentic payment infrastructure for Sui.

## Quick Start

```bash
# 1. Install
npm install -g @sweefi/cli

# 2. Configure
export SUI_PRIVATE_KEY="suiprivkey1..."
export SUI_NETWORK="testnet"

# 3. Pay
sweefi pay 0xRecipient... 1.5 --idempotency-key $(uuidgen)
```

**Prerequisites:** Node.js >= 22

## Commands

| Command | Description |
|---------|-------------|
| `sweefi pay <recipient> <amount>` | Execute a payment on Sui |
| `sweefi pay-402 --url <URL>` | Handle HTTP 402 Payment Required automatically |
| `sweefi balance [address]` | Check wallet balance |
| `sweefi receipt <object-id>` | Fetch an on-chain payment receipt |
| `sweefi prepaid deposit <provider> <amount>` | Open a prepaid balance |
| `sweefi prepaid status <balance-id>` | Check prepaid budget |
| `sweefi prepaid list [address]` | List prepaid balances |
| `sweefi mandate create <agent> <per-tx> <total> <expires>` | Set spending caps |
| `sweefi mandate check <mandate-id>` | Verify mandate status |
| `sweefi mandate list [address]` | List active mandates |
| `sweefi wallet generate` | Generate a new keypair |
| `sweefi doctor` | Run setup diagnostics |
| `sweefi schema` | Machine-readable command manifest |

## Output

All commands return JSON by default. Pass `--human` for human-readable output.

```json
{
  "ok": true,
  "command": "pay",
  "version": "0.3.0",
  "data": {
    "txDigest": "...",
    "recipient": "0x...",
    "amount": "1500000000",
    "amountFormatted": "1.5 SUI",
    "gasCostSui": "0.001420",
    "explorerUrl": "https://suiscan.xyz/testnet/tx/..."
  },
  "meta": {
    "network": "testnet",
    "durationMs": 412,
    "cliVersion": "0.3.0",
    "requestId": "a1b2c3d4-..."
  }
}
```

## Idempotent Payments

`--idempotency-key` prevents double-spend when agents crash and retry:

```bash
# First call — executes payment
sweefi pay 0xBob... 1.5 --idempotency-key 550e8400-e29b-41d4-a716-446655440000

# Retry with same key — returns existing receipt, no new TX
sweefi pay 0xBob... 1.5 --idempotency-key 550e8400-e29b-41d4-a716-446655440000
```

**Required** in JSON mode (default) for both `pay` and `pay-402`. Auto-generated in `--human` mode.

### Limitations

Idempotency uses on-chain memo scanning (paginated `getOwnedObjects`). This protects against **sequential retries** (after Sui's ~400ms finality), not concurrent execution from multiple processes. For high-volume senders with 1000+ receipts, the scan may become slow. A future on-chain IdempotencyRegistry will provide O(1) guaranteed lookup.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUI_PRIVATE_KEY` | Yes (for transactions) | Wallet key (bech32 `suiprivkey1...` or base64) |
| `SUI_NETWORK` | No | `testnet` (default), `mainnet`, or `devnet` |
| `SUI_RPC_URL` | No | Custom RPC endpoint |
| `SUI_PACKAGE_ID` | No | Override deployed contract package ID |

No config files. Environment variables only. Zero stored state = zero drift.

## Global Flags

| Flag | Description |
|------|-------------|
| `--network <testnet\|mainnet\|devnet>` | Override `SUI_NETWORK` |
| `--human` | Human-readable output |
| `--dry-run` | Simulate without executing |
| `--idempotency-key <uuid>` | Dedup key for crash-safe payments |
| `--verbose` | Debug output on stderr |
| `--timeout <ms>` | RPC timeout (default: 30000) |

## Agent Integration

`sweefi schema` emits a machine-readable JSON manifest for MCP tool registration and LLM function-calling:

```bash
sweefi schema | jq '.commands[].name'
```

Error responses include structured fields for programmatic handling:

```json
{
  "ok": false,
  "error": {
    "code": "TX_OBJECT_CONFLICT",
    "message": "Concurrent object access",
    "retryable": true,
    "suggestedAction": "This is transient — retry in a few seconds",
    "retryAfterMs": 2000
  }
}
```

## Known Limitations

- **Facilitator dependency**: `pay-402` routes payments through a facilitator service for settlement. If the facilitator is unreachable, `pay-402` will fail even with a funded wallet. Run `sweefi doctor` to check connectivity.
- **Double probe**: `pay-402` makes two HTTP requests to the target URL before payment (one from the CLI, one from the s402 client internally). This is a performance issue, not a safety issue.
- **Idempotency scan**: Uses paginated on-chain receipt scanning. For high-volume senders (1000+ receipts), the check may be slow. A future on-chain registry will provide O(1) lookup.

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
