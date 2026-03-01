# @sweefi/cli

CLI for AI agent payments on Sui — pay, stream, escrow, and manage mandates from the terminal.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem — open-source agentic payment infrastructure for Sui.

## Prerequisites

- **Node.js >= 22** (required — uses modern JS features)

## Installation

```bash
npm install -g @sweefi/cli
```

## Quick Start

```bash
# Set up your wallet
export SUI_PRIVATE_KEY=suiprivkey1...
export SUI_NETWORK=testnet

# Make a payment
sweefi pay 0xRecipient... 1.5 --coin SUI

# Handle a paywalled API (HTTP 402)
sweefi pay-402 --url https://api.example.com/premium

# Check balance
sweefi balance

# Open a prepaid budget (1,000 API calls = 2 on-chain TXs)
sweefi prepaid deposit 0xProvider... 10 --rate 10000000

# Authorize agent spending
sweefi mandate create 0xAgent... 1 50 7d
```

## Output

All commands return JSON by default. Pass `--human` for human-readable output.

```json
{
  "ok": true,
  "command": "pay",
  "version": "0.1.0",
  "data": {
    "txDigest": "...",
    "amountFormatted": "1.5 SUI",
    "gasCostSui": "0.000007"
  }
}
```

## License

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
