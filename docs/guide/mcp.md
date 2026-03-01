# @sweefi/mcp

MCP server exposing 30 default + 5 opt-in payment tools for AI agents. Works with Claude Desktop, Cursor, and any [MCP](https://modelcontextprotocol.io)-compatible client.

## Install

```bash
pnpm add @sweefi/mcp
```

Or run directly:

```bash
npx @sweefi/mcp
```

## What It Does

When registered as an MCP server, any compatible AI agent can discover SweeFi's entire payment surface through natural language. "Pay 0.001 SUI to 0x..." triggers `sweefi_pay`. "Create a prepaid budget for this API" triggers `sweefi_prepaid_deposit`.

The MCP server signs transactions internally using `SUI_PRIVATE_KEY` — no adapter or external signing needed. The `requireSigner()` helper throws a clear error if the key is missing.

## Setup

See [MCP + Claude Desktop Setup](/guide/mcp-setup) for configuration.

## Library API

```typescript
import { createSweefiMcpServer } from '@sweefi/mcp';

const { server, context } = createSweefiMcpServer({
  network: 'testnet',
  privateKey: process.env.SUI_PRIVATE_KEY,
});
```

### `createSweefiMcpServer(config)`

Creates an MCP server with all tools registered.

| Param | Type | Description |
|-------|------|-------------|
| `network` | `string` | `testnet`, `mainnet`, or `devnet` |
| `privateKey` | `string?` | Base64 or bech32 Ed25519 key |
| `rpcUrl` | `string?` | Custom RPC endpoint |
| `packageId` | `string?` | Override contract package |
| `protocolStateId` | `string?` | Override ProtocolState object |
| `enableAdminTools` | `boolean?` | Enable admin tools (default: false) |
| `enableProviderTools` | `boolean?` | Enable provider tools (default: false) |

Returns `{ server: McpServer, context: SweefiContext }`.

## Tools by Category

### Payments (4 tools)

| Tool | Description |
|------|-------------|
| `sweefi_pay` | Direct payment with receipt. Params: `recipient`, `amount`, `coinType`, `memo` |
| `sweefi_pay_and_prove` | Pay + SEAL proof. Same params as `pay` plus `proofRecipient` |
| `sweefi_create_invoice` | Create invoice NFT. Params: `recipient`, `amount`, `feeMicroPercent`, `feeRecipient` |
| `sweefi_pay_invoice` | Consume invoice with payment. Params: `invoiceId` |

### Streaming (4 tools)

| Tool | Description |
|------|-------------|
| `sweefi_start_stream` | Create streaming meter. Params: `recipient`, `depositAmount`, `ratePerSecond`, `budgetCap`, `coinType` |
| `sweefi_start_stream_with_timeout` | Create with custom timeout. Same plus `recipientCloseTimeoutMs` |
| `sweefi_stop_stream` | Close stream (payer only). Params: `meterId` |
| `sweefi_recipient_close_stream` | Force-close abandoned stream. Params: `meterId` |

### Escrow (4 tools)

| Tool | Description |
|------|-------------|
| `sweefi_create_escrow` | Create time-locked escrow. Params: `seller`, `arbiter`, `amount`, `deadlineMs`, `description`, `coinType` |
| `sweefi_release_escrow` | Release funds to seller. Params: `escrowId` |
| `sweefi_refund_escrow` | Refund to buyer (after deadline). Params: `escrowId` |
| `sweefi_dispute_escrow` | Escalate to arbiter. Params: `escrowId` |

### Prepaid (7 tools)

| Tool | Description |
|------|-------------|
| `sweefi_prepaid_deposit` | Fund a prepaid balance. Params: `provider`, `amount`, `ratePerCall`, `maxCalls`, `coinType` |
| `sweefi_prepaid_top_up` | Add funds to existing balance. Params: `balanceId`, `amount` |
| `sweefi_prepaid_request_withdrawal` | Start 2-phase withdrawal. Params: `balanceId` |
| `sweefi_prepaid_finalize_withdrawal` | Complete withdrawal after delay. Params: `balanceId` |
| `sweefi_prepaid_cancel_withdrawal` | Cancel pending withdrawal. Params: `balanceId` |
| `sweefi_prepaid_agent_close` | Close fully-consumed balance. Params: `balanceId` |
| `sweefi_prepaid_status` | Check balance details (read-only). Params: `balanceId` |

### Mandates (7 tools)

| Tool | Description |
|------|-------------|
| `sweefi_create_mandate` | Create basic spending mandate. Params: `delegate`, `maxPerTx`, `maxTotal`, `expiresAtMs`, `coinType` |
| `sweefi_create_agent_mandate` | Create L0–L3 tiered mandate. Params: `delegate`, `level`, `maxPerTx`, `dailyLimit`, `weeklyLimit`, `maxTotal` |
| `sweefi_basic_mandated_pay` | Pay using basic mandate. Params: `recipient`, `amount`, `mandateId`, `registryId` |
| `sweefi_agent_mandated_pay` | Pay using agent mandate. Params: `recipient`, `amount`, `mandateId`, `registryId` |
| `sweefi_revoke_mandate` | Instantly revoke. Params: `mandateId`, `registryId` |
| `sweefi_create_registry` | Create revocation registry |
| `sweefi_inspect_mandate` | Check mandate state (read-only). Params: `mandateId` |

### Read-Only (4 tools)

| Tool | Description |
|------|-------------|
| `sweefi_check_balance` | SUI/USDC/USDT balance. Params: `address`, `coinType` |
| `sweefi_check_payment` | Payment history. Params: `address` |
| `sweefi_get_receipt` | Fetch receipt details. Params: `receiptId` |
| `sweefi_supported_tokens` | List supported tokens for the network |

### Opt-In: Provider (1 tool)

Enable with `MCP_ENABLE_PROVIDER_TOOLS=true`:

| Tool | Description |
|------|-------------|
| `sweefi_prepaid_claim` | Claim earnings from a prepaid balance. Params: `balanceId`, `cumulativeCallCount` |

### Opt-In: Admin (4 tools)

Enable with `MCP_ENABLE_ADMIN_TOOLS=true`:

| Tool | Description |
|------|-------------|
| `sweefi_protocol_status` | Check if protocol is paused |
| `sweefi_pause_protocol` | Emergency pause (blocks new deposits, not exits) |
| `sweefi_unpause_protocol` | Resume operations |
| `sweefi_burn_admin_cap` | Permanently destroy admin capability (irreversible) |

## Next Steps

- [MCP + Claude Desktop Setup](/guide/mcp-setup) — Configuration guide
- [@sweefi/sui](/guide/sui) — PTB builders used by MCP tools
- [Mandates](/guide/mandates) — Spending authorization for agents
