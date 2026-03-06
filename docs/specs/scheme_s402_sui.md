# s402 Payment Method Specification for AP2

**Status:** Draft
**Date:** 2026-02-28
**Protocol Version:** s402 v1
**npm:** `s402@0.1.7`

## Summary

s402 is a Sui-native HTTP 402 payment protocol with five settlement schemes, Move-enforced spending mandates, and dual transport (headers + JSON body). This document defines `"s402"` as an AP2 payment method identifier for use in `PaymentMethodData.supported_methods`.

## Payment Method Identifier

```
"s402"
```

AP2's `PaymentMethodData.supported_methods` is an open list of strings. Merchants and agents that accept s402 declare `"s402"` in their supported methods. No central registry — the spec below defines what `"s402"` means.

## Network Identifiers

CAIP-2 format:

| Network | Identifier |
|---------|-----------|
| Sui Testnet | `sui:testnet` |
| Sui Mainnet | `sui:mainnet` |

## Supported Assets

| Asset | Coin Type |
|-------|-----------|
| SUI | `0x2::sui::SUI` |
| USDsui | `0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI` |
| USDC (Sui) | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |

Additional `Coin<T>` types supported via the generic coin type parameter.

## Payment Schemes

s402 supports five settlement schemes. x402 supports only `exact`.

| Scheme | Description | Use Case |
|--------|-------------|----------|
| `exact` | One-time payment of exact amount | API calls, content access |
| `prepaid` | Deposit into shared vault, provider draws per-call | High-frequency micropayments (sub-cent) |
| `stream` | Time-based streaming payment with rate cap | Continuous compute, real-time data feeds |
| `escrow` | Payment held until delivery confirmed or disputed | Marketplace transactions, service delivery |
| `unlock` | Payment + SEAL decryption key release | Pay-to-decrypt encrypted content on Walrus |

## Dual Transport

s402 supports two wire transports. Both produce identical parsed objects — the same validators apply.

### Header Transport (default)

Payment data encoded as base64 JSON in HTTP headers:

| Direction | Header | Content |
|-----------|--------|---------|
| Server → Client | `payment-required` | Base64-encoded `s402PaymentRequirements` |
| Client → Server | `x-payment` | Base64-encoded `s402PaymentPayload` |
| Server → Client | `payment-response` | Base64-encoded `s402SettleResponse` |

**Limit:** Subject to server/proxy header size limits (Nginx: 4-8KB, Node.js: 16KB). Suitable for simple payments (< 8KB).

### Body Transport (large payloads)

Payment data as raw JSON in request/response body:

| Direction | Content-Type | Content |
|-----------|-------------|---------|
| Server → Client | `application/s402+json` | JSON `s402PaymentRequirements` |
| Client → Server | `application/s402+json` | JSON `s402PaymentPayload` |
| Server → Client | `application/s402+json` | JSON `s402SettleResponse` |

**Limit:** Server-configurable body limits (Express: 100KB, Nginx: 1MB). Suitable for complex DeFi PTBs (Sui max PTB: 128KB).

**Selection:** Clients should default to header transport. Use body transport for payloads > 8KB or when interacting with complex DeFi PTBs.

## Protocol Flow

### Exact Scheme (standard flow)

```
1. Client → Resource Server:  GET /api/resource
2. Resource Server → Client:  HTTP 402
                              payment-required: <base64 s402PaymentRequirements>
3. Client constructs Sui PTB:  SplitCoins + TransferObjects to payTo
4. Client signs PTB (Ed25519)
5. Client → Resource Server:  GET /api/resource
                              x-payment: <base64 s402PaymentPayload>
6. Resource Server → Facilitator:  Verify (simulate PTB)
7. Resource Server prepares response
8. Resource Server → Facilitator:  Settle (broadcast PTB)
9. Facilitator → Sui Network:  Execute transaction (atomic)
10. Resource Server → Client:  HTTP 200 + resource
                               payment-response: <base64 s402SettleResponse>
```

### Settlement: Atomic PTB Execution

s402 on Sui uses Programmable Transaction Blocks (PTBs). The entire payment — coin split, transfer, optional mandate check, optional receipt mint — executes as a single atomic transaction. There is no temporal gap between verification and settlement.

Contrast with x402 `exact` on EVM: uses `EIP-3009` (transferWithAuthorization) which has a temporal gap between the `approve` and `transfer` steps. On Sui, both protocols would be atomic (PTB model guarantees this), but x402 has no Sui implementation — all PRs (#340, #381, #382) were closed.

## PaymentRequirements

```typescript
{
  s402Version: "1",
  accepts: ["exact"],            // which schemes the server accepts
  network: "sui:testnet",        // CAIP-2 network identifier
  asset: "0x2::sui::SUI",        // Move coin type
  amount: "1000000000",          // base units (MIST for SUI)
  payTo: "0x<64-hex-chars>",     // recipient address (32 bytes)
  facilitatorUrl?: string,       // facilitator endpoint
  mandate?: {                    // agent spending authorization
    required: boolean,
    minPerTx?: string,
    coinType?: string
  },
  protocolFeeBps?: number,       // advisory fee (0-10000 bps)
  settlementMode?: "facilitator" | "direct",
  expiresAt?: number,            // Unix timestamp ms

  // Scheme-specific extensions:
  stream?: { ratePerSecond, budgetCap, minDeposit, streamSetupUrl? },
  escrow?: { seller, arbiter?, deadlineMs },
  unlock?: { encryptionId, walrusBlobId, encryptionPackageId },
  prepaid?: { ratePerCall, maxCalls?, minDeposit, withdrawalDelayMs },
  extensions?: Record<string, unknown>
}
```

## PaymentPayload

```typescript
{
  s402Version: "1",
  scheme: "exact",               // which scheme is being used
  payload: {
    transaction: "<base64 PTB>", // signed Sui transaction
    signature: "<base64 sig>"    // Ed25519 signature
  }
}
```

Scheme-specific payload extensions:
- `unlock`: adds `encryptionId` (string)
- `prepaid`: adds `ratePerCall` (string), optional `maxCalls` (string)

## SettleResponse

```typescript
{
  success: boolean,
  txDigest?: string,      // Sui transaction digest
  receiptId?: string,     // on-chain receipt NFT object ID
  finalityMs?: number,    // time to finality
  streamId?: string,      // stream scheme: StreamingMeter object ID
  escrowId?: string,      // escrow scheme: Escrow object ID
  balanceId?: string,     // prepaid scheme: PrepaidBalance object ID
  error?: string,
  errorCode?: string      // typed error code for programmatic handling
}
```

## Verification

Steps to verify a payment for any scheme:

1. Verify `network` matches the expected chain.
2. Verify the `signature` is valid over the `transaction` (Ed25519).
3. Simulate the transaction via Sui RPC `dryRunTransactionBlock` to ensure it would succeed.
4. Verify the simulation effects: recipient address (`payTo`) receives exactly `amount` in `asset`.
5. For mandate-gated payments: verify the mandate object exists, is not revoked, and the payment is within caps (`max_per_tx`, `daily_limit`, etc.).

## Mandate Integration (AP2 Bridge)

s402 supports agent spending authorization via SweeFi's on-chain mandate system:

| AP2 Concept | s402/SweeFi Equivalent | Notes |
|---|---|---|
| Intent Mandate TTL | `expires_at_ms` on Mandate | Same concept |
| User identity | `delegator` address | Off-chain → on-chain mapping needed |
| Agent identity | `delegate` address | Off-chain → on-chain mapping needed |
| Cart amount | Validated against `max_per_tx` | s402 is a cap, AP2 is exact |
| N/A | `max_total` (lifetime cap) | s402-only |
| N/A | `daily_limit` / `weekly_limit` | s402-only |
| N/A | Authorization Level (L0-L3) | s402-only |
| Revocation | `RevocationRegistry` | Instant, same-block, on-chain |

See `@sweefi/ap2-adapter` for the TypeScript adapter that maps AP2 mandate JSON to SweeFi mandate parameters.

## Sponsored Transactions

s402 supports Sui's gas sponsorship protocol. If the facilitator offers sponsorship, it communicates this via `PaymentRequirements.extensions.gasStation`. The client constructs a partial PTB (without gas), sends it to the gas station, receives a fully-formed transaction, signs it, and sends it as the payment. The facilitator co-signs as sponsor during settlement.

## x402 Compatibility

s402@0.1.7 ships a bidirectional x402 compatibility layer (`s402/compat`):

- `normalizeRequirements()` — auto-detects x402 V1, V2 envelope, or s402 format
- `fromX402Requirements()` / `toX402Requirements()` — bidirectional conversion
- `fromX402Payload()` / `toX402Payload()` — payload conversion (exact scheme only)

x402 agents that produce Sui PTBs in x402 format can be processed by s402 servers without code changes. s402-only features (5 schemes, mandates, dual transport) are not available via x402 format.

## How s402 Differs from x402

| Capability | s402 | x402 |
|---|---|---|
| Payment schemes | 5 (exact, prepaid, stream, escrow, unlock) | 1 (exact) |
| Sui implementation | Shipped (s402@0.1.7) | Spec only (all PRs closed) |
| Settlement | Atomic PTB (no temporal gap) | EVM: temporal gap. Sui: would be atomic but unimplemented. |
| Spending mandates | Move-enforced (per-tx, daily, weekly, lifetime caps, L0-L3 levels) | Not supported |
| Revocation | Same-block on-chain (RevocationRegistry) | Not supported |
| Transport | Dual (headers + JSON body) | JSON body only (V2) |
| On-chain enforcement | Move consensus | Trusts payment processor |
| Micropayments | Prepaid scheme (batch settlement, sub-cent viable) | Per-tx settlement only |
| Pay-to-decrypt | Unlock scheme (SEAL + Walrus integration) | Not supported |

## References

- [s402 Protocol](https://s402-protocol.org)
- [s402 npm package](https://www.npmjs.com/package/s402)
- [SweeFi Monorepo](https://github.com/user/sweefi) (AP2 adapter, facilitator, SDK)
- [AP2 Specification](https://ap2-protocol.org/specification/)
- [x402 Sui Scheme Spec](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_sui.md)
- [Sui Programmable Transaction Blocks](https://docs.sui.io/concepts/transactions/prog-txn-blocks)
