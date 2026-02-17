# @sweepay/mcp

Give your AI agent a wallet. 30 payment tools for Claude, Cursor, and any MCP-compatible AI.

`@sweepay/mcp` is an [MCP server](https://modelcontextprotocol.io/) that exposes SweePay's on-chain payment primitives as tools your AI agent can discover and call. Direct payments, streaming micropayments, escrow, prepaid API billing, and mandated spending — all on Sui.

Part of the [SweePay](https://github.com/Danny-Devs/sweepay) ecosystem.

## Quickstart

### 1. Get a Sui wallet key

```bash
# Generate a new testnet key (or use an existing one)
sui client new-address ed25519
sui keytool export --key-identity <alias> --json
# Copy the bech32 key (suiprivkey1...)
```

### 2. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sweepay": {
      "command": "npx",
      "args": ["@sweepay/mcp"],
      "env": {
        "SUI_PRIVATE_KEY": "suiprivkey1...",
        "SUI_NETWORK": "testnet"
      }
    }
  }
}
```

### 3. Add to Cursor

Edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "sweepay": {
      "command": "npx",
      "args": ["@sweepay/mcp"],
      "env": {
        "SUI_PRIVATE_KEY": "suiprivkey1...",
        "SUI_NETWORK": "testnet"
      }
    }
  }
}
```

### 4. Ask your agent to pay someone

> "Send 0.1 SUI to 0xb0b..."

The agent discovers `sweepay_pay`, builds the transaction, signs it, and returns the receipt.

## Tools (30 default + 5 opt-in)

### Payments
| Tool | Description |
|------|-------------|
| `sweepay_pay` | Direct on-chain payment with receipt |
| `sweepay_pay_and_prove` | Pay + SEAL proof in one transaction |
| `sweepay_create_invoice` | Create payment invoice NFT |
| `sweepay_pay_invoice` | Pay and consume an invoice |

### Streaming
| Tool | Description |
|------|-------------|
| `sweepay_start_stream` | Start rate-limited micropayment stream |
| `sweepay_start_stream_with_timeout` | Stream with custom recipient-close timeout |
| `sweepay_stop_stream` | Close stream, settle balances |
| `sweepay_recipient_close_stream` | Force-close abandoned stream |

### Escrow
| Tool | Description |
|------|-------------|
| `sweepay_create_escrow` | Time-locked escrow with arbiter |
| `sweepay_release_escrow` | Release funds to seller |
| `sweepay_refund_escrow` | Refund buyer (deadline or arbiter) |
| `sweepay_dispute_escrow` | Escalate to arbiter |

### Prepaid API Billing
| Tool | Description |
|------|-------------|
| `sweepay_prepaid_deposit` | Fund a prepaid balance for an API provider |
| `sweepay_prepaid_top_up` | Add funds to existing balance |
| `sweepay_prepaid_request_withdrawal` | Start two-phase withdrawal |
| `sweepay_prepaid_finalize_withdrawal` | Complete withdrawal after grace period |
| `sweepay_prepaid_cancel_withdrawal` | Cancel pending withdrawal |
| `sweepay_prepaid_agent_close` | Close fully-consumed balance |
| `sweepay_prepaid_status` | Check balance state (read-only) |

### Mandated Spending
| Tool | Description |
|------|-------------|
| `sweepay_create_mandate` | Create basic spending mandate |
| `sweepay_create_agent_mandate` | Create tiered mandate (L0-L3) with daily/weekly caps |
| `sweepay_basic_mandated_pay` | Pay using basic mandate |
| `sweepay_agent_mandated_pay` | Pay using agent mandate |
| `sweepay_revoke_mandate` | Instantly revoke a mandate |
| `sweepay_create_registry` | Create revocation registry |
| `sweepay_inspect_mandate` | Check mandate state (read-only) |

### Read-Only
| Tool | Description |
|------|-------------|
| `sweepay_check_balance` | Check SUI/USDC/USDT balance |
| `sweepay_check_payment` | Query payment history |
| `sweepay_get_receipt` | Fetch receipt details |
| `sweepay_supported_tokens` | List supported tokens |

### Opt-In: Provider Tools (`MCP_ENABLE_PROVIDER_TOOLS=true`)
| Tool | Description |
|------|-------------|
| `sweepay_prepaid_claim` | Claim earnings from prepaid balance |

### Opt-In: Admin Tools (`MCP_ENABLE_ADMIN_TOOLS=true`)
| Tool | Description |
|------|-------------|
| `sweepay_protocol_status` | Check if protocol is paused |
| `sweepay_pause_protocol` | Emergency pause (requires AdminCap) |
| `sweepay_unpause_protocol` | Resume operations |
| `sweepay_burn_admin_cap` | Burn AdminCap permanently (IRREVERSIBLE) |

## Configuration

All configuration is via environment variables or the programmatic API.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUI_PRIVATE_KEY` | For transactions | — | Bech32 (`suiprivkey1...`) or base64 Ed25519 key |
| `SUI_NETWORK` | No | `testnet` | `testnet`, `mainnet`, or `devnet` |
| `SUI_RPC_URL` | No | Network default | Custom RPC endpoint |
| `SUI_PACKAGE_ID` | No | Testnet default | SweePay Move package ID |
| `SUI_PROTOCOL_STATE_ID` | For create ops | — | ProtocolState shared object ID |
| `MCP_MAX_PER_TX` | No | `0` (unlimited) | Max base units per transaction |
| `MCP_MAX_PER_SESSION` | No | `0` (unlimited) | Max cumulative base units per session |
| `MCP_ENABLE_ADMIN_TOOLS` | No | `false` | Enable admin tools |
| `MCP_ENABLE_PROVIDER_TOOLS` | No | `false` | Enable provider-side tools |

Without `SUI_PRIVATE_KEY`, only read-only tools are available (balance, receipts, status checks).

## Security Model

**MCP spending limits** (`MCP_MAX_PER_TX`, `MCP_MAX_PER_SESSION`) guard against LLM misbehavior — e.g., the model deciding to spend 1000 SUI instead of 0.001. They are a best-effort safety net, not a hard security boundary.

**On-chain Mandates** are the real enforcement layer. Create a mandate with `sweepay_create_agent_mandate` to set per-transaction, daily, weekly, and lifetime caps that Move enforces atomically. Even if the MCP server is compromised, the mandate limits hold.

**Layered defense:**
1. MCP limits → catches LLM mistakes early (in-process)
2. Mandate limits → enforced by Sui validators (on-chain)
3. Revocation → instant kill switch via `sweepay_revoke_mandate`

## Programmatic Usage

```typescript
import { createSweepayMcpServer } from '@sweepay/mcp';

const { server, context } = createSweepayMcpServer({
  network: 'testnet',
  privateKey: process.env.SUI_PRIVATE_KEY,
  maxAmountPerTx: 1_000_000_000n, // 1 SUI max per tx
});

// Connect to your preferred transport
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const transport = new StdioServerTransport();
await server.connect(transport);
```

## License

MIT
