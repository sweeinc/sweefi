# @sweefi/mcp

Give your AI agent a wallet. 35 AI agent tools for Claude, Cursor, and any MCP-compatible AI (30 default + 5 opt-in).

`@sweefi/mcp` is an [MCP server](https://modelcontextprotocol.io/) that exposes SweeFi's on-chain payment primitives as tools your AI agent can discover and call. Direct payments, streaming micropayments, escrow, prepaid API billing, and mandated spending — all on Sui.

**Apache 2.0 open source.** Part of the [SweeFi](https://github.com/sweeinc/sweefi) ecosystem.

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
    "sweefi": {
      "command": "npx",
      "args": ["@sweefi/mcp"],
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
    "sweefi": {
      "command": "npx",
      "args": ["@sweefi/mcp"],
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

The agent discovers `sweefi_pay`, builds the transaction, signs it, and returns the receipt.

## Tools (30 default + 5 opt-in)

### Payments
| Tool | Description |
|------|-------------|
| `sweefi_pay` | Direct on-chain payment with receipt |
| `sweefi_pay_and_prove` | Pay + SEAL proof in one transaction |
| `sweefi_create_invoice` | Create payment invoice NFT |
| `sweefi_pay_invoice` | Pay and consume an invoice |

### Streaming
| Tool | Description |
|------|-------------|
| `sweefi_start_stream` | Start rate-limited micropayment stream |
| `sweefi_start_stream_with_timeout` | Stream with custom recipient-close timeout |
| `sweefi_stop_stream` | Close stream, settle balances |
| `sweefi_recipient_close_stream` | Force-close abandoned stream |

### Escrow
| Tool | Description |
|------|-------------|
| `sweefi_create_escrow` | Time-locked escrow with arbiter |
| `sweefi_release_escrow` | Release funds to seller |
| `sweefi_refund_escrow` | Refund buyer (deadline or arbiter) |
| `sweefi_dispute_escrow` | Escalate to arbiter |

### Prepaid API Billing
| Tool | Description |
|------|-------------|
| `sweefi_prepaid_deposit` | Fund a prepaid balance for an API provider |
| `sweefi_prepaid_top_up` | Add funds to existing balance |
| `sweefi_prepaid_request_withdrawal` | Start two-phase withdrawal |
| `sweefi_prepaid_finalize_withdrawal` | Complete withdrawal after grace period |
| `sweefi_prepaid_cancel_withdrawal` | Cancel pending withdrawal |
| `sweefi_prepaid_agent_close` | Close fully-consumed balance |
| `sweefi_prepaid_status` | Check balance state (read-only) |

> **v0.2 Signed Receipts (planned):** Deposit-with-receipts, finalize-claim, dispute-claim, and withdraw-disputed tools are available at the PTB layer (`@sweefi/sui/ptb`) and will be exposed as MCP tools in a future release. These enable cryptographic fraud proofs for prepaid billing.

### Mandated Spending
| Tool | Description |
|------|-------------|
| `sweefi_create_mandate` | Create basic spending mandate |
| `sweefi_create_agent_mandate` | Create tiered mandate (L0-L3) with daily/weekly caps |
| `sweefi_basic_mandated_pay` | Pay using basic mandate |
| `sweefi_agent_mandated_pay` | Pay using agent mandate |
| `sweefi_revoke_mandate` | Instantly revoke a mandate |
| `sweefi_create_registry` | Create revocation registry |
| `sweefi_inspect_mandate` | Check mandate state (read-only) |

### Read-Only
| Tool | Description |
|------|-------------|
| `sweefi_check_balance` | Check SUI/USDC/USDT balance |
| `sweefi_check_payment` | Query payment history |
| `sweefi_get_receipt` | Fetch receipt details |
| `sweefi_supported_tokens` | List supported tokens |

### Opt-In: Provider Tools (`MCP_ENABLE_PROVIDER_TOOLS=true`)
| Tool | Description |
|------|-------------|
| `sweefi_prepaid_claim` | Claim earnings from prepaid balance |

### Opt-In: Admin Tools (`MCP_ENABLE_ADMIN_TOOLS=true`)
| Tool | Description |
|------|-------------|
| `sweefi_protocol_status` | Check if protocol is paused |
| `sweefi_pause_protocol` | Emergency pause (requires AdminCap) |
| `sweefi_unpause_protocol` | Resume operations |
| `sweefi_burn_admin_cap` | Burn AdminCap permanently (IRREVERSIBLE) |

## Configuration

All configuration is via environment variables or the programmatic API.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUI_PRIVATE_KEY` | For transactions | — | Bech32 (`suiprivkey1...`) or base64 Ed25519 key |
| `SUI_NETWORK` | No | `testnet` | `testnet`, `mainnet`, or `devnet` |
| `SUI_RPC_URL` | No | Network default | Custom RPC endpoint |
| `SUI_PACKAGE_ID` | No | Testnet default | SweeFi Move package ID |
| `SUI_PROTOCOL_STATE_ID` | For create ops | — | ProtocolState shared object ID |
| `MCP_MAX_PER_TX` | No | `0` (unlimited) | Max base units per transaction |
| `MCP_MAX_PER_SESSION` | No | `0` (unlimited) | Max cumulative base units per session |
| `MCP_ENABLE_ADMIN_TOOLS` | No | `false` | Enable admin tools |
| `MCP_ENABLE_PROVIDER_TOOLS` | No | `false` | Enable provider-side tools |

Without `SUI_PRIVATE_KEY`, only read-only tools are available (balance, receipts, status checks).

## Security Model

**MCP spending limits** (`MCP_MAX_PER_TX`, `MCP_MAX_PER_SESSION`) guard against LLM misbehavior — e.g., the model deciding to spend 1000 SUI instead of 0.001. They are a best-effort safety net, not a hard security boundary.

**On-chain Mandates** are the real enforcement layer. Create a mandate with `sweefi_create_agent_mandate` to set per-transaction, daily, weekly, and lifetime caps that Move enforces atomically. Even if the MCP server is compromised, the mandate limits hold.

**Layered defense:**
1. MCP limits → catches LLM mistakes early (in-process)
2. Mandate limits → enforced by Sui validators (on-chain)
3. Revocation → instant kill switch via `sweefi_revoke_mandate`

## Programmatic Usage

```typescript
import { createSweefiMcpServer } from '@sweefi/mcp';

const { server, context } = createSweefiMcpServer({
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

Apache 2.0 — [https://github.com/sweeinc/sweefi](https://github.com/sweeinc/sweefi)
