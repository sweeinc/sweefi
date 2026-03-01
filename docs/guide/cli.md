# @sweefi/cli

Terminal CLI for manual testing, debugging, and AI agent integration. JSON-first output, zero stored state (env vars only).

## Install

```bash
pnpm add -g @sweefi/cli
```

Or run directly:

```bash
npx @sweefi/cli balance
```

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUI_PRIVATE_KEY` | For payments | — | Base64 or bech32 Ed25519 key |
| `SUI_NETWORK` | No | `testnet` | `testnet`, `mainnet`, or `devnet` |
| `SUI_RPC_URL` | No | — | Custom RPC endpoint |
| `SUI_PACKAGE_ID` | No | — | Override contract package |

## Commands

### Payments

```bash
# Direct payment
sweefi pay <recipient> <amount>
sweefi pay 0xRECIPIENT 1000000 --coin SUI

# Pay with mandate authorization
sweefi pay <recipient> <amount> --mandate <id> --registry <id>

# Auto-pay a 402-gated URL
sweefi pay-402 --url https://api.example.com/premium
```

### Balance & Receipts

```bash
# Check balance (defaults to your address)
sweefi balance
sweefi balance 0xSOME_ADDRESS --coin USDC

# Fetch receipt details
sweefi receipt <object-id>
```

### Prepaid

```bash
# Deposit budget for an API provider
sweefi prepaid deposit <provider> <amount>

# Check balance status
sweefi prepaid status <balance-id>

# List prepaid balances
sweefi prepaid list
sweefi prepaid list 0xADDRESS
```

### Mandates

```bash
# Create spending mandate for an agent
sweefi mandate create <agent> <per-tx-cap> <total-cap> <expires-ms>

# Check mandate state
sweefi mandate check <mandate-id>

# List mandates
sweefi mandate list
```

### Wallet

```bash
# Generate a new keypair
sweefi wallet generate
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--network <testnet\|mainnet\|devnet>` | Override `SUI_NETWORK` |
| `--coin <SUI\|USDC\|USDT>` | Token type |
| `--human` | Human-readable output (default is JSON) |
| `--dry-run` | Simulate without broadcasting |
| `-v, --version` | Print version |
| `-h, --help` | Print help |

## Output Format

All commands output JSON by default (machine-readable for AI agents):

```json
{
  "ok": true,
  "command": "pay",
  "version": "0.1.0",
  "data": {
    "txDigest": "AbC123...",
    "amountFormatted": "0.001 SUI",
    "gasCostSui": "0.000007"
  }
}
```

Use `--human` for formatted terminal output.

## Next Steps

- [Quick Start — Agent](/guide/quickstart-agent) — Programmatic agent setup
- [@sweefi/sui](/guide/sui) — PTB builders used by the CLI
- [Prepaid](/guide/prepaid) — Prepaid budget lifecycle
