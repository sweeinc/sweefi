# MCP + Claude Desktop Setup

Give Claude (or any MCP-compatible AI) 35 payment tools via `@sweefi/mcp`.

## What Is MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is Anthropic's standard for giving AI agents access to tools. When you register `@sweefi/mcp` as an MCP server, Claude can:

- Check balances and payment history
- Send exact payments
- Create and manage streaming meters
- Deposit prepaid budgets
- Create escrows with arbiters
- Issue and consume mandates (spending authorizations)

All from natural language — "pay 0.001 SUI to 0x... for the API call."

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sweefi": {
      "command": "npx",
      "args": ["@sweefi/mcp"],
      "env": {
        "SUI_NETWORK": "testnet",
        "SUI_PRIVATE_KEY": "<base64 Ed25519 key>"
      }
    }
  }
}
```

Or, if you've cloned the repo:

```json
{
  "mcpServers": {
    "sweefi": {
      "command": "node",
      "args": ["packages/mcp/dist/cli.mjs"],
      "env": {
        "SUI_NETWORK": "testnet",
        "SUI_PRIVATE_KEY": "<base64 Ed25519 key>"
      }
    }
  }
}
```

## Getting a Key

```bash
# Generate a new keypair
sui client new-address ed25519

# Export the private key (base64)
sui keytool export --key-identity <address>

# Fund it on testnet
# Visit https://faucet.sui.io
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUI_PRIVATE_KEY` | Yes | — | Base64 or bech32 Ed25519 key |
| `SUI_NETWORK` | No | `testnet` | `testnet`, `mainnet`, or `devnet` |
| `SUI_RPC_URL` | No | — | Custom RPC endpoint |
| `SUI_PACKAGE_ID` | No | — | Override contract package ID |
| `SUI_PROTOCOL_STATE_ID` | No | — | Override ProtocolState object |
| `MCP_MAX_PER_TX` | No | — | Per-transaction spending cap (MIST) |
| `MCP_MAX_PER_SESSION` | No | — | Per-session spending cap (MIST) |
| `MCP_ENABLE_ADMIN_TOOLS` | No | `false` | Enable protocol admin tools |
| `MCP_ENABLE_PROVIDER_TOOLS` | No | `false` | Enable provider-side tools |

## Available Tools

### Default (30 tools)

| Category | Tools |
|----------|-------|
| **Payments** | `sweefi_pay`, `sweefi_pay_and_prove`, `sweefi_create_invoice`, `sweefi_pay_invoice` |
| **Streaming** | `sweefi_start_stream`, `sweefi_start_stream_with_timeout`, `sweefi_stop_stream`, `sweefi_recipient_close_stream` |
| **Escrow** | `sweefi_create_escrow`, `sweefi_release_escrow`, `sweefi_refund_escrow`, `sweefi_dispute_escrow` |
| **Prepaid** | `sweefi_prepaid_deposit`, `sweefi_prepaid_top_up`, `sweefi_prepaid_request_withdrawal`, `sweefi_prepaid_finalize_withdrawal`, `sweefi_prepaid_cancel_withdrawal`, `sweefi_prepaid_agent_close`, `sweefi_prepaid_status` |
| **Mandates** | `sweefi_create_mandate`, `sweefi_create_agent_mandate`, `sweefi_basic_mandated_pay`, `sweefi_agent_mandated_pay`, `sweefi_revoke_mandate`, `sweefi_create_registry`, `sweefi_inspect_mandate` |
| **Read-Only** | `sweefi_check_balance`, `sweefi_check_payment`, `sweefi_get_receipt`, `sweefi_supported_tokens` |

### Opt-In Provider (1 tool)

Set `MCP_ENABLE_PROVIDER_TOOLS=true`:

| Tool | Description |
|------|-------------|
| `sweefi_prepaid_claim` | Claim earnings from a prepaid balance |

### Opt-In Admin (4 tools)

Set `MCP_ENABLE_ADMIN_TOOLS=true`:

| Tool | Description |
|------|-------------|
| `sweefi_protocol_status` | Check if protocol is paused |
| `sweefi_pause_protocol` | Emergency pause (blocks new deposits) |
| `sweefi_unpause_protocol` | Resume operations |
| `sweefi_burn_admin_cap` | Permanently destroy admin capability |

## Spending Limits

The MCP server signs transactions internally using `SUI_PRIVATE_KEY`. Set spending caps to limit exposure:

```json
{
  "env": {
    "SUI_PRIVATE_KEY": "<key>",
    "MCP_MAX_PER_TX": "10000000",
    "MCP_MAX_PER_SESSION": "100000000"
  }
}
```

This limits each transaction to 0.01 SUI and each session to 0.1 SUI.

## Next Steps

- [@sweefi/mcp Reference](/guide/mcp) — Full tool documentation
- [Quick Start — Agent](/guide/quickstart-agent) — Programmatic agent setup
- [Mandates](/guide/mandates) — Spending authorization for agents
