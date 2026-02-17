# @sweepay/cli

CLI for AI agent payments on Sui — the bridge between OpenClaw skills and the SweePay protocol.

Part of the [SweePay](https://github.com/anthropics/sweepay) ecosystem — open-source agentic payment infrastructure for Sui.

## Installation

```bash
npm install -g @sweepay/cli
```

## Quick Start

```bash
# Set up your wallet
export SUI_PRIVATE_KEY=suiprivkey1...
export SUI_NETWORK=testnet

# Make a payment
sweepay pay 0xRecipient... 1.5 --coin SUI

# Handle a paywalled API (HTTP 402)
sweepay pay-402 --url https://api.example.com/premium

# Check balance
sweepay balance

# Open a prepaid budget (500x cheaper for repeated API calls)
sweepay prepaid deposit 0xProvider... 10 --rate 10000000

# Authorize agent spending
sweepay mandate create 0xAgent... 1 50 7d
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

MIT
